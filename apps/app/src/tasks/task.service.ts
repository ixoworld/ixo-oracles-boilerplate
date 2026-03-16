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
 * Task index (`ixo.ora.tasks.index`):
 *   - State event on the main channel — live index of all tasks
 *
 * @see spec §6.1 — Architecture
 */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { Preset, Visibility } from 'matrix-js-sdk';
import { normalizeDid } from 'src/utils/header.utils';

import { MatrixManager } from '@ixo/matrix';
import { BLOCKNOTE_TOOLS_CONFIG } from 'src/graph/agents/editor/blocknote-tools';
import { EditorMatrixClient } from 'src/graph/agents/editor/editor-mx';

import { TasksScheduler } from './scheduler/tasks-scheduler.service';
import type {
  DeliverJobData,
  SimpleJobData,
  WorkJobData,
} from './scheduler/types';
import type { CreateTaskMetaParams } from './task-doc';
import {
  buildTaskMeta,
  generateTaskId,
  readTaskMeta,
  updateTaskMeta,
  writeTaskMetaToDoc,
} from './task-doc';
import { sharedServerEditor, withTaskDoc } from './task-doc-helpers';
import type { ChannelType, TaskMeta, TaskType } from './task-meta';
import { buildTaskPageParams, generateTaskPage } from './task-page-template';
import type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  ListTasksOptions,
  ListTasksResult,
  TaskIndexEntry,
  TasksIndexChunk,
  TasksIndexHeader,
  UpdateTaskParams,
} from './task-service.types';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PAGE_SIZE,
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PAGE_SIZE,
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';
export type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  ListTasksOptions,
  ListTasksResult,
  TaskIndexEntry,
  TasksIndexChunk,
  TasksIndexHeader,
  UpdateTaskParams,
} from './task-service.types';

// ── Service ─────────────────────────────────────────────────────────

/** Cache TTL for task index header + chunks (ms) */
const INDEX_CACHE_TTL = 30_000;

/** Cache TTL for individual task meta (ms) */
const TASK_META_CACHE_TTL = 30_000;

/** Cache TTL for individual task index entries (ms) */
const ENTRY_CACHE_TTL = 30_000;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly scheduler: TasksScheduler,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private headerCacheKey(mainRoomId: string): string {
    return `tasks:header:${mainRoomId}`;
  }

  private chunkCacheKey(mainRoomId: string, chunkIndex: number): string {
    return `tasks:chunk:${mainRoomId}:${chunkIndex}`;
  }

  private indexCacheKey(mainRoomId: string): string {
    return `tasks:index:${mainRoomId}`;
  }

  private entryCacheKey(mainRoomId: string, taskId: string): string {
    return `tasks:entry:${mainRoomId}:${taskId}`;
  }

  private taskMetaCacheKey(mainRoomId: string, taskId: string): string {
    return `tasks:meta:${mainRoomId}:${taskId}`;
  }

  private async invalidateTaskCaches(
    mainRoomId: string,
    taskId?: string,
  ): Promise<void> {
    await this.cache.del(this.headerCacheKey(mainRoomId));
    await this.cache.del(this.indexCacheKey(mainRoomId));
    if (taskId) {
      await this.cache.del(this.taskMetaCacheKey(mainRoomId, taskId));
      await this.cache.del(this.entryCacheKey(mainRoomId, taskId));
    }
  }

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
      currentWorkJobId: scheduleResult.currentWorkJobId,
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

    const finalTaskMeta = { ...taskMeta, ...schedulerUpdates };

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

    // 7. Warm the cache with the fresh meta
    await this.cache.set(
      this.taskMetaCacheKey(params.mainRoomId, taskId),
      finalTaskMeta,
      TASK_META_CACHE_TTL,
    );

    this.logger.log(`Task ${taskId} created successfully`);
    return { taskId, taskMeta: finalTaskMeta, roomId, roomAlias };
  }

  // ── Get ─────────────────────────────────────────────────────────

  async getTask(
    params: GetTaskParams,
    options?: { bypassCache?: boolean },
  ): Promise<TaskMeta> {
    const { taskId, mainRoomId } = params;

    // Check cache first (unless bypassed)
    if (!options?.bypassCache) {
      const cacheKey = this.taskMetaCacheKey(mainRoomId, taskId);
      const cached = await this.cache.get<TaskMeta>(cacheKey);
      if (cached) return cached;
    }

    const entry = await this.resolveTaskEntry(mainRoomId, taskId);
    let meta: TaskMeta;

    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? mainRoomId;
      meta = await this.readTaskMetaFromDoc(targetRoomId);
    } else {
      // Read state event from main room
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
      );
      meta = content as unknown as TaskMeta;
    }

    const cacheKey = this.taskMetaCacheKey(mainRoomId, taskId);
    await this.cache.set(cacheKey, meta, TASK_META_CACHE_TTL);
    return meta;
  }

  // ── List ────────────────────────────────────────────────────────

  async listTasks(
    mainRoomId: string,
    options?: ListTasksOptions,
  ): Promise<ListTasksResult> {
    const page = options?.page ?? 0;
    const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

    // Load all entries (cached after first call)
    const all = await this.loadAllEntries(mainRoomId);
    const totalCount = all.length;
    const pageCount = Math.max(Math.ceil(totalCount / pageSize), 1);
    const start = page * pageSize;
    const tasks = all.slice(start, start + pageSize);

    return { tasks, totalCount, page, pageSize, pageCount };
  }

  /**
   * Load all index entries from all chunks. Result is cached.
   */
  private async loadAllEntries(mainRoomId: string): Promise<TaskIndexEntry[]> {
    const cacheKey = this.indexCacheKey(mainRoomId);
    const cached = await this.cache.get<TaskIndexEntry[]>(cacheKey);
    if (cached) return cached;

    const header = await this.readHeader(mainRoomId);
    if (!header) return [];

    // Read all chunks in parallel
    const chunkPromises = Array.from({ length: header.chunkCount }, (_, i) =>
      this.readChunk(mainRoomId, i),
    );
    const chunks = await Promise.all(chunkPromises);

    const tasks: TaskIndexEntry[] = [];
    for (const chunk of chunks) {
      tasks.push(...Object.values(chunk));
    }

    await this.cache.set(cacheKey, tasks, INDEX_CACHE_TTL);
    return tasks;
  }

  // ── Update ──────────────────────────────────────────────────────

  async updateTask(params: UpdateTaskParams): Promise<TaskMeta> {
    const { taskId, mainRoomId, updates } = params;
    this.logger.log(`Updating task ${taskId}`);

    const entry = await this.resolveTaskEntry(mainRoomId, taskId);

    // Invalidate caches before writes so reads within this flow are fresh
    await this.invalidateTaskCaches(mainRoomId, taskId);

    // 1. Apply metadata updates
    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? mainRoomId;
      await this.updateTaskMetaInDoc(targetRoomId, updates);
    } else {
      // Read current (cache just cleared), merge, write back
      const current = await this.getTask({ taskId, mainRoomId });
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

    // Invalidate after write so subsequent reads are fresh
    await this.invalidateTaskCaches(mainRoomId, taskId);

    // 2. If schedule changed, cancel and reschedule
    if (
      params.newScheduleCron !== undefined ||
      params.newDeadlineIso !== undefined
    ) {
      const taskMeta = await this.getTask({ taskId, mainRoomId });

      await this.scheduler.cancelAllJobsForTask(
        taskId,
        taskMeta.bullmqRepeatKey,
        taskMeta.currentWorkJobId,
      );

      const scheduleResult = await this.scheduleTask(taskMeta, {
        mainRoomId,
        message: undefined,
        scheduleCron: taskMeta.scheduleCron ?? undefined,
        deadlineIso: taskMeta.deadlineIso ?? undefined,
        timezone: taskMeta.timezone,
      });

      const schedulerUpdates: Partial<TaskMeta> = {
        bullmqJobId: scheduleResult.bullmqJobId,
        bullmqRepeatKey: scheduleResult.bullmqRepeatKey,
        nextRunAt: scheduleResult.nextRunAt,
        currentWorkJobId: scheduleResult.currentWorkJobId,
      };

      if (entry.hasPage) {
        const targetRoomId = entry.roomId ?? mainRoomId;
        await this.updateTaskMetaInDoc(targetRoomId, schedulerUpdates);
      } else {
        const current = await this.getTask({ taskId, mainRoomId });
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

      // Invalidate after scheduler updates
      await this.invalidateTaskCaches(mainRoomId, taskId);
    }

    // 3. Read final state and update index
    const finalMeta = await this.getTask({ taskId, mainRoomId });

    await this.updateTasksIndex(
      mainRoomId,
      {
        ...entry,
        status: finalMeta.status,
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
    const { taskId, mainRoomId } = params;
    this.logger.log(`Deleting task ${taskId}`);

    // Look up the task to get its repeat key and work job ID for cancellation
    const entry = await this.resolveTaskEntry(mainRoomId, taskId);
    let repeatKey: string | null = null;
    let currentWorkJobId: string | null = null;
    try {
      const meta = await this.getTask({ taskId, mainRoomId });
      repeatKey = meta.bullmqRepeatKey;
      currentWorkJobId = meta.currentWorkJobId;
    } catch {
      // Task meta may already be gone — best effort
    }

    // 1. Cancel all BullMQ jobs
    await this.scheduler.cancelAllJobsForTask(
      taskId,
      repeatKey,
      currentWorkJobId,
    );

    // 2. Remove from index
    await this.updateTasksIndex(mainRoomId, entry, 'remove');

    // 3. Clean up caches (index is also invalidated inside updateTasksIndex)
    await this.invalidateTaskCaches(mainRoomId, taskId);

    // Note: Room archival is handled by ORA-192 (separate issue)
    this.logger.log(`Task ${taskId} deleted`);
  }

  // ── Private: Index Lookup ───────────────────────────────────────

  /**
   * Look up a task's index entry to resolve hasPage, roomId, etc.
   * Uses header's taskChunkMap for O(1) resolution — two Matrix reads max.
   */
  private async resolveTaskEntry(
    mainRoomId: string,
    taskId: string,
  ): Promise<TaskIndexEntry> {
    // Check per-entry cache first
    const eCacheKey = this.entryCacheKey(mainRoomId, taskId);
    const cached = await this.cache.get<TaskIndexEntry>(eCacheKey);
    if (cached) return cached;

    const header = await this.readHeader(mainRoomId);
    if (!header) {
      throw new Error(`Task ${taskId} not found in index`);
    }

    const chunkIndex = header.taskChunkMap[taskId];
    if (chunkIndex === undefined) {
      throw new Error(`Task ${taskId} not found in index`);
    }

    const chunk = await this.readChunk(mainRoomId, chunkIndex);
    const entry = chunk[taskId];
    if (!entry) {
      throw new Error(`Task ${taskId} not found in chunk ${chunkIndex}`);
    }

    await this.cache.set(eCacheKey, entry, ENTRY_CACHE_TTL);
    return entry;
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
    const blocks = await sharedServerEditor.tryParseMarkdownToBlocks(markdown);

    // Resolve ownerDid before entering the doc lifecycle
    const editorClient = EditorMatrixClient.getInstance();
    await editorClient.init();
    const ownerDid = normalizeDid(editorClient.getClient().getUserId()!);
    const createdAt = new Date().toISOString();

    await withTaskDoc(params.roomId, (doc) => {
      doc.transact(() => {
        const root = doc.getMap('root');
        root.set('@context', 'https://ixo.world/page/0.1');
        root.set('createdAt', createdAt);
        root.set('ownerDid', ownerDid);
        doc.getText('title').insert(0, params.title);
      });

      if (blocks.length > 0) {
        const fragment = doc.getXmlFragment('document');
        sharedServerEditor.blocksToYXmlFragment(blocks, fragment);
      }

      writeTaskMetaToDoc(doc, params.taskMeta);
    });

    this.logger.log(`Task page doc initialized for ${params.taskId}`);
  }

  // ── Private: Read/Update TaskMeta via Y.Doc ─────────────────────

  private async readTaskMetaFromDoc(roomId: string): Promise<TaskMeta> {
    return withTaskDoc(roomId, (doc) => readTaskMeta(doc));
  }

  private async updateTaskMetaInDoc(
    roomId: string,
    updates: Partial<TaskMeta>,
  ): Promise<void> {
    await withTaskDoc(roomId, (doc) => {
      updateTaskMeta(doc, { ...updates, updatedAt: new Date().toISOString() });
    });
  }

  // ── Private: Task Index (Chunked) ──────────────────────────────

  /**
   * Read the index header. Returns null if no index exists yet.
   */
  private async readHeader(
    mainRoomId: string,
  ): Promise<TasksIndexHeader | null> {
    const cacheKey = this.headerCacheKey(mainRoomId);
    const cached = await this.cache.get<TasksIndexHeader>(cacheKey);
    if (cached) return cached;

    try {
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASKS_INDEX_EVENT_TYPE,
        '',
      );
      const header = content as unknown as TasksIndexHeader;
      await this.cache.set(cacheKey, header, INDEX_CACHE_TTL);
      return header;
    } catch {
      return null;
    }
  }

  /**
   * Read a single chunk by index. Returns empty object if chunk doesn't exist.
   */
  private async readChunk(
    mainRoomId: string,
    chunkIndex: number,
  ): Promise<TasksIndexChunk> {
    const cacheKey = this.chunkCacheKey(mainRoomId, chunkIndex);
    const cached = await this.cache.get<TasksIndexChunk>(cacheKey);
    if (cached) return cached;

    try {
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASKS_INDEX_EVENT_TYPE,
        `chunk:${chunkIndex}`,
      );
      const chunk = content as unknown as TasksIndexChunk;
      await this.cache.set(cacheKey, chunk, INDEX_CACHE_TTL);
      return chunk;
    } catch {
      return {};
    }
  }

  /**
   * Upsert or remove a task entry in the chunked index.
   */
  private async updateTasksIndex(
    mainRoomId: string,
    entry: TaskIndexEntry,
    action: 'upsert' | 'remove',
  ): Promise<void> {
    let header = await this.readHeader(mainRoomId);

    if (action === 'upsert') {
      if (!header) {
        // Bootstrap: create header + chunk:0
        header = {
          totalCount: 0,
          chunkSize: DEFAULT_CHUNK_SIZE,
          chunkCount: 1,
          updatedAt: new Date().toISOString(),
          taskChunkMap: {},
        };
        // Write empty chunk:0 as starting point
        await this.sendStateEvent(
          mainRoomId,
          TASKS_INDEX_EVENT_TYPE,
          'chunk:0',
          {},
        );
      }

      const existingChunkIdx = header.taskChunkMap[entry.taskId];

      if (existingChunkIdx !== undefined) {
        // Update existing entry in its chunk
        const chunk = await this.readChunk(mainRoomId, existingChunkIdx);
        chunk[entry.taskId] = entry;
        await this.sendStateEvent(
          mainRoomId,
          TASKS_INDEX_EVENT_TYPE,
          `chunk:${existingChunkIdx}`,
          chunk,
        );
      } else {
        // New entry — find a chunk with space
        let targetChunkIdx = -1;
        for (let ci = 0; ci < header.chunkCount; ci++) {
          const chunk = await this.readChunk(mainRoomId, ci);
          if (Object.keys(chunk).length < header.chunkSize) {
            targetChunkIdx = ci;
            chunk[entry.taskId] = entry;
            await this.sendStateEvent(
              mainRoomId,
              TASKS_INDEX_EVENT_TYPE,
              `chunk:${ci}`,
              chunk,
            );
            break;
          }
        }

        if (targetChunkIdx === -1) {
          // All chunks full — create new chunk
          targetChunkIdx = header.chunkCount;
          const newChunk: TasksIndexChunk = { [entry.taskId]: entry };
          await this.sendStateEvent(
            mainRoomId,
            TASKS_INDEX_EVENT_TYPE,
            `chunk:${targetChunkIdx}`,
            newChunk,
          );
          header.chunkCount += 1;
        }

        header.taskChunkMap[entry.taskId] = targetChunkIdx;
        header.totalCount += 1;
      }

      header.updatedAt = new Date().toISOString();
      await this.sendStateEvent(mainRoomId, TASKS_INDEX_EVENT_TYPE, '', header);
    } else {
      // Remove
      if (!header) return;

      const chunkIdx = header.taskChunkMap[entry.taskId];
      if (chunkIdx === undefined) return;

      const chunk = await this.readChunk(mainRoomId, chunkIdx);
      delete chunk[entry.taskId];
      await this.sendStateEvent(
        mainRoomId,
        TASKS_INDEX_EVENT_TYPE,
        `chunk:${chunkIdx}`,
        chunk,
      );

      delete header.taskChunkMap[entry.taskId];
      header.totalCount = Math.max(header.totalCount - 1, 0);
      header.updatedAt = new Date().toISOString();
      // Leave empty chunks in place — they get reused on next insert
      await this.sendStateEvent(mainRoomId, TASKS_INDEX_EVENT_TYPE, '', header);
    }

    // Invalidate caches — next read will fetch fresh data
    await this.invalidateTaskCaches(mainRoomId);
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
    currentWorkJobId: string | null;
  }> {
    const roomId = taskMeta.customRoomId ?? params.mainRoomId;

    if (taskMeta.jobPattern === 'simple') {
      return {
        ...(await this.scheduleSimpleTask(taskMeta, roomId, params)),
        currentWorkJobId: null,
      };
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
    currentWorkJobId: string | null;
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
        currentWorkJobId: result.workJobId,
      };
    }

    if (taskMeta.deadlineIso) {
      // One-shot flow — work job ID is deterministic via FlowProducer
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
        currentWorkJobId: result.workJobId,
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
      currentWorkJobId: result.workJobId,
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
    content:
      | Record<string, unknown>
      | TaskMeta
      | TasksIndexHeader
      | TasksIndexChunk,
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
