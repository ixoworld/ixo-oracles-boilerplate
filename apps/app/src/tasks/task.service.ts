/**
 * TasksService — CRUD layer for scheduled tasks.
 *
 * Handles task creation, retrieval, listing, updating, and deletion.
 *
 * Tasks WITH pages (`hasPage: true`):
 *   - Get a dedicated `[Task]` Matrix room + Y.Doc with taskMeta sidecar
 *   - Room creation and Y.Doc init are split into separate concerns
 *
 * Tasks WITHOUT pages (`hasPage: false`):
 *   - Metadata stored as a Matrix state event on the main agent room
 *   - No Y.Doc, no dedicated room — lightweight
 *
 * Task index (`com.ora.tasks.index`):
 *   - State event on the main channel — live index of all tasks
 *
 * @see spec §6.1 — Architecture
 */

import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { Injectable, Logger } from '@nestjs/common';
import { Preset, Visibility } from 'matrix-js-sdk';
import { normalizeDid } from 'src/utils/header.utils';

import { EditorMatrixClient } from 'src/graph/agents/editor/editor-mx';
import { BLOCKNOTE_TOOLS_CONFIG } from 'src/graph/agents/editor/blocknote-tools';
import { MatrixProviderManager } from 'src/graph/agents/editor/provider';
import type { AppConfig } from 'src/graph/agents/editor/config';
import { MatrixManager } from '@ixo/matrix';

import {
  buildTaskMeta,
  generateTaskId,
  readTaskMeta,
  updateTaskMeta,
  writeTaskMetaToDoc,
} from './task-doc';
import type { CreateTaskMetaParams } from './task-doc';
import { buildTaskPageParams, generateTaskPage } from './task-page-template';
import { TasksScheduler } from './scheduler/tasks-scheduler.service';
import type { ChannelType, TaskMeta, TaskType } from './task-meta';
import type {
  DeliverJobData,
  SimpleJobData,
  WorkJobData,
} from './scheduler/types';
import {
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';
import type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  TaskIndexEntry,
  TasksIndexContent,
  UpdateTaskParams,
} from './task-service.types';

export {
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';
export type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  TaskIndexEntry,
  TasksIndexContent,
  UpdateTaskParams,
} from './task-service.types';

// ── Singleton editor for markdown → blocks parsing ──────────────────

const serverEditor = ServerBlockNoteEditor.create();

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly scheduler: TasksScheduler) {}

  // ── Create ──────────────────────────────────────────────────────

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const taskId = generateTaskId();
    this.logger.log(`Creating task ${taskId}: ${params.title}`);

    // 1. Build TaskMeta
    const metaParams: CreateTaskMetaParams = {
      taskId,
      userId: params.userId,
      taskType: params.taskType,
      hasPage: params.hasPage,
      timezone: params.timezone,
      scheduleCron: params.scheduleCron,
      deadlineIso: params.deadlineIso,
      channelType: params.channelType,
      complexityTier: params.complexityTier,
      monthlyBudgetUsd: params.monthlyBudgetUsd,
      modelOverride: params.modelOverride,
      requiresApproval: params.requiresApproval,
      dependsOn: params.dependsOn,
    };

    let roomId: string | null = null;
    let roomAlias: string | null = null;

    // 2. If custom channel, create a dedicated [Task] room
    if (params.channelType === 'custom') {
      const roomResult = await this.createTaskRoom({
        taskId,
        title: params.title,
        userId: params.userId,
        inviteUserIds: params.inviteUserIds,
      });
      roomId = roomResult.roomId;
      roomAlias = roomResult.alias;
      metaParams.customRoomId = roomId;
    }

    const taskMeta = buildTaskMeta(metaParams);

    // 3. Store metadata
    if (params.hasPage) {
      // Create Y.Doc with page content + taskMeta sidecar
      const targetRoomId = roomId ?? params.mainRoomId;
      await this.initTaskPageDoc({
        taskId,
        title: params.title,
        roomId: targetRoomId,
        taskMeta,
        scheduleDescription: params.scheduleDescription ?? '',
        whatToDo: params.whatToDo ?? '',
        howToReport: params.howToReport ?? '',
        constraints: params.constraints,
        channelType: params.channelType,
        taskType: params.taskType,
      });
    } else {
      // Store as state event on main room
      await this.sendStateEvent(
        params.mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
        taskMeta,
      );
    }

    // 4. Schedule BullMQ job
    const scheduleResult = await this.scheduleTask(taskMeta, params);

    // 5. Update TaskMeta with scheduler references
    const schedulerUpdates: Partial<TaskMeta> = {
      bullmqJobId: scheduleResult.bullmqJobId,
      bullmqRepeatKey: scheduleResult.bullmqRepeatKey,
      nextRunAt: scheduleResult.nextRunAt,
    };

    if (params.hasPage) {
      const targetRoomId = roomId ?? params.mainRoomId;
      await this.updateTaskMetaInDoc(targetRoomId, schedulerUpdates);
    } else {
      const currentMeta = { ...taskMeta, ...schedulerUpdates };
      await this.sendStateEvent(
        params.mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
        currentMeta,
      );
    }

    Object.assign(taskMeta, schedulerUpdates);

    // 6. Update task index
    await this.updateTasksIndex(
      params.mainRoomId,
      {
        taskId,
        title: params.title,
        status: taskMeta.status,
        taskType: taskMeta.taskType,
        channelType: taskMeta.channelType,
        roomId,
        roomAlias,
        nextRunAt: taskMeta.nextRunAt,
        hasPage: params.hasPage,
      },
      'upsert',
    );

    this.logger.log(`Task ${taskId} created successfully`);
    return { taskId, taskMeta, roomId, roomAlias };
  }

  // ── Get ─────────────────────────────────────────────────────────

  async getTask(params: GetTaskParams): Promise<TaskMeta> {
    if (params.hasPage) {
      const targetRoomId = params.roomId ?? params.mainRoomId;
      return this.readTaskMetaFromDoc(targetRoomId);
    }

    // Read state event from main room
    const client = this.getSimpleMatrixClient();
    const content = await client.mxClient.getRoomStateEvent(
      params.mainRoomId,
      TASK_STATE_EVENT_TYPE,
      params.taskId,
    );
    return content as unknown as TaskMeta;
  }

  // ── List ────────────────────────────────────────────────────────

  async listTasks(mainRoomId: string): Promise<TaskIndexEntry[]> {
    try {
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASKS_INDEX_EVENT_TYPE,
        '',
      );
      const index = content as unknown as TasksIndexContent;
      return index.tasks ?? [];
    } catch {
      // No index yet — return empty
      return [];
    }
  }

  // ── Update ──────────────────────────────────────────────────────

  async updateTask(params: UpdateTaskParams): Promise<TaskMeta> {
    const { taskId, mainRoomId, updates, hasPage } = params;
    this.logger.log(`Updating task ${taskId}`);

    // 1. Apply metadata updates
    if (hasPage) {
      const targetRoomId = params.roomId ?? mainRoomId;
      await this.updateTaskMetaInDoc(targetRoomId, updates);
    } else {
      // Read current, merge, write back
      const current = await this.getTask({
        taskId,
        mainRoomId,
        hasPage: false,
      });
      const merged = {
        ...current,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await this.sendStateEvent(
        mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
        merged,
      );
    }

    // 2. If schedule changed, cancel and reschedule
    if (
      params.newScheduleCron !== undefined ||
      params.newDeadlineIso !== undefined
    ) {
      const taskMeta = await this.getTask({
        taskId,
        mainRoomId,
        roomId: params.roomId,
        hasPage,
      });

      await this.scheduler.cancelAllJobsForTask(
        taskId,
        taskMeta.bullmqRepeatKey,
      );

      // Re-read after update to get latest meta for scheduling
      const updatedMeta = await this.getTask({
        taskId,
        mainRoomId,
        roomId: params.roomId,
        hasPage,
      });

      const scheduleResult = await this.scheduleTask(updatedMeta, {
        mainRoomId,
        message: undefined,
        scheduleCron: updatedMeta.scheduleCron ?? undefined,
        deadlineIso: updatedMeta.deadlineIso ?? undefined,
        timezone: updatedMeta.timezone,
      });

      const schedulerUpdates: Partial<TaskMeta> = {
        bullmqJobId: scheduleResult.bullmqJobId,
        bullmqRepeatKey: scheduleResult.bullmqRepeatKey,
        nextRunAt: scheduleResult.nextRunAt,
      };

      if (hasPage) {
        const targetRoomId = params.roomId ?? mainRoomId;
        await this.updateTaskMetaInDoc(targetRoomId, schedulerUpdates);
      } else {
        const current = await this.getTask({
          taskId,
          mainRoomId,
          hasPage: false,
        });
        const merged = {
          ...current,
          ...schedulerUpdates,
          updatedAt: new Date().toISOString(),
        };
        await this.sendStateEvent(
          mainRoomId,
          TASK_STATE_EVENT_TYPE,
          taskId,
          merged,
        );
      }
    }

    // 3. Read final state and update index
    const finalMeta = await this.getTask({
      taskId,
      mainRoomId,
      roomId: params.roomId,
      hasPage,
    });

    await this.updateTasksIndex(
      mainRoomId,
      {
        taskId,
        title: finalMeta.taskId, // title not in TaskMeta — use taskId for index
        status: finalMeta.status,
        taskType: finalMeta.taskType,
        channelType: finalMeta.channelType,
        roomId: finalMeta.customRoomId,
        roomAlias: null,
        nextRunAt: finalMeta.nextRunAt,
        hasPage: finalMeta.hasPage,
      },
      'upsert',
    );

    this.logger.log(`Task ${taskId} updated`);
    return finalMeta;
  }

  // ── Delete ──────────────────────────────────────────────────────

  async deleteTask(params: DeleteTaskParams): Promise<void> {
    const { taskId, mainRoomId, repeatKey } = params;
    this.logger.log(`Deleting task ${taskId}`);

    // 1. Cancel all BullMQ jobs
    await this.scheduler.cancelAllJobsForTask(taskId, repeatKey);

    // 2. Remove from index
    await this.updateTasksIndex(
      mainRoomId,
      { taskId } as TaskIndexEntry,
      'remove',
    );

    // Note: Room archival is handled by ORA-192 (separate issue)
    this.logger.log(`Task ${taskId} deleted`);
  }

  // ── Private: Room Creation ──────────────────────────────────────

  private async createTaskRoom(params: {
    taskId: string;
    title: string;
    userId: string;
    inviteUserIds?: string[];
  }): Promise<{ roomId: string; alias: string }> {
    const editorClient = EditorMatrixClient.getInstance();
    await editorClient.init();
    const matrixClient = editorClient.getClient();

    const alias = `task-${params.taskId}`;
    const creatorId = matrixClient.getUserId()!;
    const homeserver = BLOCKNOTE_TOOLS_CONFIG.matrix.baseUrl.replace(
      /^https?:\/\//,
      '',
    );

    // Power levels: creator 100, invited users 50
    const users: Record<string, number> = { [creatorId]: 100 };
    if (params.userId) {
      users[params.userId] = 50;
    }
    if (params.inviteUserIds) {
      for (const uid of params.inviteUserIds) {
        users[uid] = 50;
      }
    }

    const inviteList = [params.userId, ...(params.inviteUserIds ?? [])].filter(
      (id) => id !== creatorId,
    );

    const initialState: Array<{
      type: string;
      state_key?: string;
      content: Record<string, unknown>;
    }> = [
      {
        type: 'm.room.history_visibility',
        state_key: '',
        content: { history_visibility: 'shared' },
      },
      {
        type: 'm.room.guest_access',
        state_key: '',
        content: { guest_access: 'forbidden' },
      },
    ];

    this.logger.log(`Creating task room with alias: ${alias}`);

    const response = await matrixClient.createRoom({
      room_alias_name: alias,
      name: `[Task] ${params.title}`,
      topic: `Task: ${params.title}`,
      visibility: Visibility.Private,
      preset: Preset.PrivateChat,
      invite: inviteList,
      initial_state: initialState,
      power_level_content_override: {
        events_default: 50,
        state_default: 50,
        users_default: 0,
        users,
        events: {
          'com.yjs.webrtc.announce': 0,
          'com.yjs.webrtc.signal': 0,
        },
      },
    });

    const roomId = response.room_id;
    this.logger.log(`Task room created: ${roomId} (alias: ${alias})`);

    return { roomId, alias: `#${alias}:${homeserver}` };
  }

  // ── Private: Y.Doc Init ─────────────────────────────────────────

  private async initTaskPageDoc(params: {
    taskId: string;
    title: string;
    roomId: string;
    taskMeta: TaskMeta;
    scheduleDescription: string;
    whatToDo: string;
    howToReport: string;
    constraints?: string;
    channelType: ChannelType;
    taskType: TaskType;
  }): Promise<void> {
    const editorClient = EditorMatrixClient.getInstance();
    await editorClient.init();
    const matrixClient = editorClient.getClient();

    // Build page markdown
    const pageParams = buildTaskPageParams({
      title: params.title,
      taskType: params.taskType,
      channelType: params.channelType,
      scheduleDescription: params.scheduleDescription,
      whatToDo: params.whatToDo,
      howToReport: params.howToReport,
      constraints: params.constraints,
    });
    const markdown = generateTaskPage(pageParams);

    // Parse markdown into BlockNote blocks
    const blocks = await serverEditor.tryParseMarkdownToBlocks(markdown);

    // Build AppConfig for provider
    const appConfig: AppConfig = {
      matrix: {
        ...BLOCKNOTE_TOOLS_CONFIG.matrix,
        room: { type: 'id', value: params.roomId },
      },
      provider: BLOCKNOTE_TOOLS_CONFIG.provider,
      blocknote: { mutableAttributeKeys: [] },
    };

    const providerManager = new MatrixProviderManager(matrixClient, appConfig);
    const createdAt = new Date().toISOString();
    const ownerDid = normalizeDid(matrixClient.getUserId()!);

    try {
      const { doc } = await providerManager.init();

      // Set page metadata
      doc.transact(() => {
        const root = doc.getMap('root');
        root.set('@context', 'https://ixo.world/page/0.1');
        root.set('createdAt', createdAt);
        root.set('ownerDid', ownerDid);
        doc.getText('title').insert(0, params.title);
      });

      // Write parsed blocks into the document
      if (blocks.length > 0) {
        const fragment = doc.getXmlFragment('document');
        serverEditor.blocksToYXmlFragment(blocks, fragment);
      }

      // Write taskMeta sidecar
      writeTaskMetaToDoc(doc, params.taskMeta);
    } finally {
      await providerManager.dispose();
    }

    this.logger.log(`Task page doc initialized for ${params.taskId}`);
  }

  // ── Private: Read/Update TaskMeta via Y.Doc ─────────────────────

  private async readTaskMetaFromDoc(roomId: string): Promise<TaskMeta> {
    const editorClient = EditorMatrixClient.getInstance();
    await editorClient.init();
    const matrixClient = editorClient.getClient();

    const appConfig: AppConfig = {
      matrix: {
        ...BLOCKNOTE_TOOLS_CONFIG.matrix,
        room: { type: 'id', value: roomId },
      },
      provider: BLOCKNOTE_TOOLS_CONFIG.provider,
      blocknote: { mutableAttributeKeys: [] },
    };

    const providerManager = new MatrixProviderManager(matrixClient, appConfig);
    try {
      const { doc } = await providerManager.init();
      return readTaskMeta(doc);
    } finally {
      await providerManager.dispose();
    }
  }

  private async updateTaskMetaInDoc(
    roomId: string,
    updates: Partial<TaskMeta>,
  ): Promise<void> {
    const editorClient = EditorMatrixClient.getInstance();
    await editorClient.init();
    const matrixClient = editorClient.getClient();

    const appConfig: AppConfig = {
      matrix: {
        ...BLOCKNOTE_TOOLS_CONFIG.matrix,
        room: { type: 'id', value: roomId },
      },
      provider: BLOCKNOTE_TOOLS_CONFIG.provider,
      blocknote: { mutableAttributeKeys: [] },
    };

    const providerManager = new MatrixProviderManager(matrixClient, appConfig);
    try {
      const { doc } = await providerManager.init();
      updateTaskMeta(doc, { ...updates, updatedAt: new Date().toISOString() });
    } finally {
      await providerManager.dispose();
    }
  }

  // ── Private: Task Index ─────────────────────────────────────────

  private async updateTasksIndex(
    mainRoomId: string,
    entry: TaskIndexEntry,
    action: 'upsert' | 'remove',
  ): Promise<void> {
    let tasks: TaskIndexEntry[] = [];

    try {
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASKS_INDEX_EVENT_TYPE,
        '',
      );
      const index = content as unknown as TasksIndexContent;
      tasks = index.tasks ?? [];
    } catch {
      // No index yet — start fresh
    }

    if (action === 'upsert') {
      const idx = tasks.findIndex((t) => t.taskId === entry.taskId);
      if (idx >= 0) {
        tasks[idx] = entry;
      } else {
        tasks.push(entry);
      }
    } else {
      tasks = tasks.filter((t) => t.taskId !== entry.taskId);
    }

    const indexContent: TasksIndexContent = {
      tasks,
      updatedAt: new Date().toISOString(),
    };

    await this.sendStateEvent(
      mainRoomId,
      TASKS_INDEX_EVENT_TYPE,
      '',
      indexContent,
    );
  }

  // ── Private: Scheduling ─────────────────────────────────────────

  private async scheduleTask(
    taskMeta: TaskMeta,
    params: Pick<CreateTaskParams, 'mainRoomId' | 'message'> & {
      scheduleCron?: string;
      deadlineIso?: string;
      timezone?: string;
    },
  ): Promise<{
    bullmqJobId: string;
    bullmqRepeatKey: string | null;
    nextRunAt: string | null;
  }> {
    const roomId = taskMeta.customRoomId ?? params.mainRoomId;

    if (taskMeta.jobPattern === 'simple') {
      return this.scheduleSimpleTask(taskMeta, roomId, params);
    }

    return this.scheduleFlowTask(taskMeta, roomId);
  }

  private async scheduleSimpleTask(
    taskMeta: TaskMeta,
    roomId: string,
    params: Pick<CreateTaskParams, 'message'>,
  ): Promise<{
    bullmqJobId: string;
    bullmqRepeatKey: string | null;
    nextRunAt: string | null;
  }> {
    const data: SimpleJobData = {
      taskId: taskMeta.taskId,
      userId: taskMeta.userId,
      roomId,
      message: params.message ?? '',
    };

    if (taskMeta.scheduleCron) {
      // Recurring simple job
      const result = await this.scheduler.scheduleSimpleJob({
        taskId: taskMeta.taskId,
        data,
        repeat: { pattern: taskMeta.scheduleCron, tz: taskMeta.timezone },
      });
      return {
        bullmqJobId: result.jobId,
        bullmqRepeatKey: result.repeatKey,
        nextRunAt: null, // BullMQ computes this internally
      };
    }

    if (taskMeta.deadlineIso) {
      // One-shot simple job
      const delay = new Date(taskMeta.deadlineIso).getTime() - Date.now();
      const result = await this.scheduler.scheduleSimpleJob({
        taskId: taskMeta.taskId,
        data,
        delay: Math.max(delay, 0),
      });
      return {
        bullmqJobId: result.jobId,
        bullmqRepeatKey: null,
        nextRunAt: taskMeta.deadlineIso,
      };
    }

    // No schedule — immediate simple job
    const result = await this.scheduler.scheduleSimpleJob({
      taskId: taskMeta.taskId,
      data,
    });
    return {
      bullmqJobId: result.jobId,
      bullmqRepeatKey: null,
      nextRunAt: null,
    };
  }

  private async scheduleFlowTask(
    taskMeta: TaskMeta,
    roomId: string,
  ): Promise<{
    bullmqJobId: string;
    bullmqRepeatKey: string | null;
    nextRunAt: string | null;
  }> {
    const workData: WorkJobData = {
      taskId: taskMeta.taskId,
      userId: taskMeta.userId,
      roomId,
    };

    const deliverData: DeliverJobData = {
      taskId: taskMeta.taskId,
      userId: taskMeta.userId,
      roomId,
    };

    if (taskMeta.scheduleCron) {
      // Recurring flow
      const bufferMs = taskMeta.bufferMinutes * 60_000;
      const result = await this.scheduler.scheduleRecurringFlow({
        taskId: taskMeta.taskId,
        deliverData,
        repeat: { pattern: taskMeta.scheduleCron, tz: taskMeta.timezone },
        firstWork: {
          data: workData,
          delay: Math.max(bufferMs, 0),
        },
      });
      return {
        bullmqJobId: result.deliverJobId,
        bullmqRepeatKey: result.repeatKey,
        nextRunAt: null,
      };
    }

    if (taskMeta.deadlineIso) {
      // One-shot flow
      const deliverDelay =
        new Date(taskMeta.deadlineIso).getTime() - Date.now();
      const bufferMs = taskMeta.bufferMinutes * 60_000;
      const workDelay = Math.max(deliverDelay - bufferMs, 0);

      const result = await this.scheduler.scheduleFlowJob({
        taskId: taskMeta.taskId,
        workData,
        deliverData,
        workDelay,
        deliverDelay: Math.max(deliverDelay, 0),
      });
      return {
        bullmqJobId: result.deliverJobId,
        bullmqRepeatKey: null,
        nextRunAt: taskMeta.deadlineIso,
      };
    }

    // No schedule — immediate flow
    const result = await this.scheduler.scheduleFlowJob({
      taskId: taskMeta.taskId,
      workData,
      deliverData,
      workDelay: 0,
      deliverDelay: 0,
    });
    return {
      bullmqJobId: result.deliverJobId,
      bullmqRepeatKey: null,
      nextRunAt: null,
    };
  }

  // ── Private: Matrix Helpers ─────────────────────────────────────

  private getSimpleMatrixClient() {
    const client = MatrixManager.getInstance().getClient();
    if (!client) {
      throw new Error('MatrixManager client not initialized');
    }
    return client;
  }

  private async sendStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
    content: Record<string, unknown> | TaskMeta | TasksIndexContent,
  ): Promise<void> {
    const client = this.getSimpleMatrixClient();
    await client.sendStateEvent(
      roomId,
      eventType,
      content as Record<string, unknown>,
      stateKey,
    );
  }
}
