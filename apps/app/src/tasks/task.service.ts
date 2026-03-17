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
import { CronExpressionParser } from 'cron-parser';
import { EventType, Preset, Visibility } from 'matrix-js-sdk';
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
} from './task-doc';
import { sharedServerEditor, withTaskDoc } from './task-doc-helpers';
import type { ChannelType, TaskMeta, TaskType } from './task-meta';
import {
  buildTaskPageParams,
  formatStatusLabel,
  generateTaskPage,
} from './task-page-template';
import type {
  CancelTaskParams,
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  ListTasksOptions,
  ListTasksResult,
  PauseTaskParams,
  ResumeTaskParams,
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
import { resolveWorkDelay } from './processors/processor-utils';

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PAGE_SIZE,
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';
export type {
  CancelTaskParams,
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskParams,
  GetTaskParams,
  ListTasksOptions,
  ListTasksResult,
  PauseTaskParams,
  ResumeTaskParams,
  TaskIndexEntry,
  TaskLifecycleParams,
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
    this.logger.debug(
      `createTask params: ${JSON.stringify({ taskId, title: params.title, taskType: params.taskType, hasPage: params.hasPage, channelType: params.channelType, jobPattern: params.scheduleCron ? 'cron' : params.deadlineIso ? 'deadline' : 'immediate', userDid: params.userDid })}`,
    );

    // 1. Build TaskMeta
    this.logger.debug(
      `[createTask ${taskId}] Step 1: Building TaskMeta (taskType=${params.taskType}, hasPage=${params.hasPage}, channelType=${params.channelType}, modelOverride=${params.modelOverride ?? 'none'}, complexityTier=${params.complexityTier ?? 'default'}, timezone=${params.timezone})`,
    );
    const metaParams: CreateTaskMetaParams = {
      taskId,
      userDid: params.userDid,
      matrixUserId: params.matrixUserId,
      taskType: params.taskType,
      hasPage: params.hasPage,
      timezone: params.timezone,
      scheduleCron: params.scheduleCron,
      deadlineIso: params.deadlineIso,
      channelType: params.channelType,
      complexityTier: params.complexityTier,
      monthlyBudgetUsd: params.monthlyBudgetUsd,
      modelOverride: params.modelOverride,
      notificationPolicy: params.notificationPolicy,
      requiresApproval: params.requiresApproval,
      dependsOn: params.dependsOn,
      spaceId: params.spaceId,
    };

    let roomId: string | null = null;
    let roomAlias: string | null = null;

    // 2. If custom channel, create a dedicated [Task] room
    if (params.channelType === 'custom') {
      this.logger.debug(
        `[createTask ${taskId}] Step 2: Creating custom task room (matrixUserId=${params.matrixUserId})`,
      );
      const roomResult = await this.createTaskRoom({
        taskId,
        title: params.title,
        matrixUserId: params.matrixUserId,
        inviteUserIds: params.inviteUserIds,
      });
      roomId = roomResult.roomId;
      roomAlias = roomResult.alias;
      metaParams.customRoomId = roomId;
      this.logger.debug(
        `[createTask ${taskId}] Step 2: Custom room created (roomId=${roomId}, alias=${roomAlias})`,
      );
    } else {
      this.logger.debug(
        `[createTask ${taskId}] Step 2: Skipped — channelType=main, using mainRoomId=${params.mainRoomId}`,
      );
    }

    const taskMeta = buildTaskMeta(metaParams);
    this.logger.debug(
      `[createTask ${taskId}] TaskMeta built: modelTier=${taskMeta.modelTier}, modelOverride=${taskMeta.modelOverride ?? 'none'}, jobPattern=${taskMeta.jobPattern}, bufferMinutes=${taskMeta.bufferMinutes}, complexityTier=${taskMeta.complexityTier}, notificationPolicy=${taskMeta.notificationPolicy}`,
    );

    // 3. Store metadata
    if (params.hasPage) {
      const targetRoomId = roomId ?? params.mainRoomId;
      this.logger.debug(
        `[createTask ${taskId}] Step 3: Storing as Y.Doc page (targetRoomId=${targetRoomId})`,
      );
      // Create Y.Doc with page content + taskMeta sidecar
      await this.initTaskPageDoc({
        taskId,
        title: params.title,
        roomId: targetRoomId,
        taskMeta,
        scheduleDescription: params.scheduleDescription ?? '',
        whatToDo: params.whatToDo ?? '',
        howToReport: params.howToReport ?? '',
        constraints: params.constraints,
        notes: params.notes,
        channelType: params.channelType,
        taskType: params.taskType,
      });
      this.logger.debug(
        `[createTask ${taskId}] Step 3: Y.Doc page initialized`,
      );
    } else {
      this.logger.debug(
        `[createTask ${taskId}] Step 3: Storing as state event (mainRoomId=${params.mainRoomId})`,
      );
      // Store as state event on main room
      await this.sendStateEvent(
        params.mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
        taskMeta,
      );
      this.logger.debug(`[createTask ${taskId}] Step 3: State event sent`);
    }

    // 4. Schedule BullMQ job
    this.logger.debug(
      `[createTask ${taskId}] Step 4: Scheduling BullMQ job (pattern=${taskMeta.jobPattern}, cron=${taskMeta.scheduleCron ?? 'none'}, deadline=${taskMeta.deadlineIso ?? 'none'})`,
    );
    const scheduleResult = await this.scheduleTask(taskMeta, params);
    this.logger.debug(
      `[createTask ${taskId}] Step 4: Scheduled (bullmqJobId=${scheduleResult.bullmqJobId}, repeatKey=${scheduleResult.bullmqRepeatKey ?? 'none'}, nextRunAt=${scheduleResult.nextRunAt ?? 'none'}, workJobId=${scheduleResult.currentWorkJobId ?? 'none'})`,
    );

    // 5. Update TaskMeta with scheduler references
    this.logger.debug(
      `[createTask ${taskId}] Step 5: Updating TaskMeta with scheduler references`,
    );
    const schedulerUpdates: Partial<TaskMeta> = {
      bullmqJobId: scheduleResult.bullmqJobId,
      bullmqRepeatKey: scheduleResult.bullmqRepeatKey,
      nextRunAt: scheduleResult.nextRunAt,
      currentWorkJobId: scheduleResult.currentWorkJobId,
    };

    if (params.hasPage) {
      const targetRoomId = roomId ?? params.mainRoomId;
      await this.updateTaskMetaInDoc(targetRoomId, schedulerUpdates);
      this.logger.debug(`[createTask ${taskId}] Step 5: Updated Y.Doc meta`);
    } else {
      const currentMeta = { ...taskMeta, ...schedulerUpdates };
      await this.sendStateEvent(
        params.mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
        currentMeta,
      );
      this.logger.debug(`[createTask ${taskId}] Step 5: Updated state event`);
    }

    const finalTaskMeta = { ...taskMeta, ...schedulerUpdates };

    // 6. Update task index
    this.logger.debug(
      `[createTask ${taskId}] Step 6: Updating task index (mainRoomId=${params.mainRoomId})`,
    );
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
    this.logger.debug(`[createTask ${taskId}] Step 6: Task index updated`);

    // 7. Warm the cache with the fresh meta
    this.logger.debug(`[createTask ${taskId}] Step 7: Warming cache`);
    await this.cache.set(
      this.taskMetaCacheKey(params.mainRoomId, taskId),
      finalTaskMeta,
      TASK_META_CACHE_TTL,
    );

    this.logger.log(
      `Task ${taskId} created successfully (type=${taskMeta.taskType}, pattern=${taskMeta.jobPattern}, model=${taskMeta.modelOverride ?? taskMeta.modelTier}, nextRunAt=${finalTaskMeta.nextRunAt ?? 'none'})`,
    );
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
      if (cached) {
        this.logger.debug(`getTask: cache HIT for task ${taskId}`);
        return cached;
      }
      this.logger.debug(`getTask: cache MISS for task ${taskId}`);
    } else {
      this.logger.debug(`getTask: cache bypassed for task ${taskId}`);
    }

    this.logger.debug(`getTask: resolving index entry for task ${taskId}...`);
    const entry = await this.resolveTaskEntry(mainRoomId, taskId);
    this.logger.debug(
      `getTask: entry resolved — hasPage=${entry.hasPage}, roomId=${entry.roomId ?? 'main'}`,
    );
    let meta: TaskMeta;

    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? mainRoomId;
      this.logger.debug(
        `getTask: reading TaskMeta from Y.Doc (room=${targetRoomId})`,
      );
      meta = await this.readTaskMetaFromDoc(targetRoomId);
    } else {
      // Read state event from main room
      this.logger.debug(
        `getTask: reading TaskMeta from state event (room=${mainRoomId})`,
      );
      const client = this.getSimpleMatrixClient();
      const content = await client.mxClient.getRoomStateEvent(
        mainRoomId,
        TASK_STATE_EVENT_TYPE,
        taskId,
      );
      meta = content as unknown as TaskMeta;
    }

    this.logger.debug(
      `getTask: loaded task ${taskId} — status=${meta.status}, totalRuns=${meta.totalRuns}`,
    );
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
    this.logger.debug(
      `updateTask: updates=${JSON.stringify(updates)}, hasNewSchedule=${params.newScheduleCron !== undefined}, hasNewDeadline=${params.newDeadlineIso !== undefined}`,
    );

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

  // ── Lifecycle: Pause / Resume / Cancel ──────────────────────────

  /**
   * Pause an active task — cancel BullMQ jobs, set status to paused.
   * The schedule is preserved; call resumeTask() to restart.
   */
  async pauseTask(params: PauseTaskParams): Promise<TaskMeta> {
    const meta = await this.getTask(params);
    if (['paused', 'cancelled', 'completed'].includes(meta.status)) {
      throw new Error(`Cannot pause task with status: ${meta.status}`);
    }
    if (!meta.scheduleCron && !meta.deadlineIso) {
      throw new Error(
        'Cannot pause an immediate task — it has no schedule to resume from',
      );
    }

    await this.scheduler.cancelAllJobsForTask(
      params.taskId,
      meta.bullmqRepeatKey,
      meta.currentWorkJobId,
    );

    const entry = await this.resolveTaskEntry(params.mainRoomId, params.taskId);

    const result = await this.updateTask({
      taskId: params.taskId,
      mainRoomId: params.mainRoomId,
      updates: {
        status: 'paused',
        nextRunAt: null,
        bullmqRepeatKey: null,
        currentWorkJobId: null,
      },
    });

    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? params.mainRoomId;
      await this.updatePageStatus(targetRoomId, 'paused');
    }

    return result;
  }

  /**
   * Resume a paused task — re-create BullMQ jobs from the existing schedule.
   * Throws if the task is not paused, or if a one-shot deadline has already passed.
   */
  async resumeTask(params: ResumeTaskParams): Promise<TaskMeta> {
    const meta = await this.getTask(params);
    if (meta.status !== 'paused') {
      throw new Error(`Task is not paused (current status: ${meta.status})`);
    }
    if (
      meta.deadlineIso &&
      !meta.scheduleCron &&
      new Date(meta.deadlineIso).getTime() < Date.now()
    ) {
      throw new Error(
        `Cannot resume: the deadline for this task has already passed (${meta.deadlineIso})`,
      );
    }

    const entry = await this.resolveTaskEntry(params.mainRoomId, params.taskId);

    const updateParams: UpdateTaskParams = {
      taskId: params.taskId,
      mainRoomId: params.mainRoomId,
      updates: { status: 'active' },
    };
    if (meta.scheduleCron) {
      updateParams.newScheduleCron = meta.scheduleCron;
    } else if (meta.deadlineIso) {
      updateParams.newDeadlineIso = meta.deadlineIso;
    }

    const result = await this.updateTask(updateParams);

    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? params.mainRoomId;
      await this.updatePageStatus(targetRoomId, 'active');
    }

    return result;
  }

  /**
   * Cancel a task permanently — cancel BullMQ jobs, set status to cancelled,
   * archive the dedicated room (if any), and update the page status.
   * The task entry remains in the index with cancelled status.
   */
  async cancelTask(params: CancelTaskParams): Promise<TaskMeta> {
    const meta = await this.getTask(params);
    if (['cancelled', 'completed'].includes(meta.status)) {
      throw new Error(`Cannot cancel task with status: ${meta.status}`);
    }

    await this.scheduler.cancelAllJobsForTask(
      params.taskId,
      meta.bullmqRepeatKey,
      meta.currentWorkJobId,
    );

    // Archive the dedicated room if one exists
    const entry = await this.resolveTaskEntry(params.mainRoomId, params.taskId);
    if (entry.roomId) {
      await this.archiveTaskRoom(entry.roomId);
    }

    // Update page status before archival makes the room read-only
    if (entry.hasPage) {
      const targetRoomId = entry.roomId ?? params.mainRoomId;
      await this.updatePageStatus(targetRoomId, 'cancelled');
    }

    return this.updateTask({
      taskId: params.taskId,
      mainRoomId: params.mainRoomId,
      updates: {
        status: 'cancelled',
        bullmqRepeatKey: null,
        currentWorkJobId: null,
        nextRunAt: null,
      },
    });
  }

  // ── Public: Index Lookup ────────────────────────────────────────

  /**
   * Public accessor for a single task's index entry.
   * Delegates to the cached `resolveTaskEntry` method.
   */
  async getTaskIndexEntry(
    mainRoomId: string,
    taskId: string,
  ): Promise<TaskIndexEntry> {
    return this.resolveTaskEntry(mainRoomId, taskId);
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
    matrixUserId: string;
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
    if (params.matrixUserId) {
      users[params.matrixUserId] = 50;
    }
    if (params.inviteUserIds) {
      for (const uid of params.inviteUserIds) {
        users[uid] = 50;
      }
    }

    const inviteList = [
      params.matrixUserId,
      ...(params.inviteUserIds ?? []),
    ].filter((id) => id !== creatorId);

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

  // ── Private: Room Archival ─────────────────────────────────────────

  /**
   * Archive a task room by making it read-only and updating the room name.
   * Sets events_default to 100 so only the bot (power 100) can post.
   */
  private async archiveTaskRoom(roomId: string): Promise<void> {
    try {
      const editorClient = EditorMatrixClient.getInstance();
      await editorClient.init();
      const matrixClient = editorClient.getClient();

      // Fetch current power levels to preserve user entries
      const currentPower = await matrixClient.getStateEvent(
        roomId,
        'm.room.power_levels',
        '',
      );

      await matrixClient.sendStateEvent(
        roomId,
        EventType.RoomPowerLevels,
        { ...currentPower, events_default: 100 },
        '',
      );

      // Prefix room name with [Archived] so the user can see it's inactive
      const nameEvent = await matrixClient
        .getStateEvent(roomId, 'm.room.name', '')
        .catch(() => null);
      const currentName: string | undefined = nameEvent?.name;
      if (currentName && !currentName.startsWith('[Archived]')) {
        await matrixClient.sendStateEvent(
          roomId,
          EventType.RoomName,
          { name: `[Archived] ${currentName}` },
          '',
        );
      }

      this.logger.log(`Task room archived: ${roomId}`);
    } catch (err) {
      // Room archival is best-effort — don't fail the cancel flow
      this.logger.warn(
        `Failed to archive task room ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    notes?: string;
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
      notes: params.notes,
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

      updateTaskMeta(doc, params.taskMeta);
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

  /**
   * Best-effort update of the "**Status:**" line in a task page's Y.Doc.
   * Finds the paragraph block containing "Status:", replaces it with the
   * new label, and writes the blocks back.
   */
  private async updatePageStatus(
    roomId: string,
    status: TaskMeta['status'],
  ): Promise<void> {
    try {
      await withTaskDoc(roomId, async (doc) => {
        const fragment = doc.getXmlFragment('document');
        const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);

        const statusIdx = blocks.findIndex(
          (b) =>
            b.type === 'paragraph' &&
            Array.isArray(b.content) &&
            b.content.some(
              (c) =>
                'type' in c &&
                c.type === 'text' &&
                'text' in c &&
                typeof c.text === 'string' &&
                c.text.includes('Status:'),
            ),
        );

        if (statusIdx === -1) return;

        const newLabel = formatStatusLabel(status);
        const statusMd = `**Status:** ${newLabel}`;
        const [statusBlock] =
          await sharedServerEditor.tryParseMarkdownToBlocks(statusMd);

        blocks[statusIdx] = { ...statusBlock, id: blocks[statusIdx].id };

        doc.transact(() => {
          while (fragment.length > 0) {
            fragment.delete(0, 1);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sharedServerEditor.blocksToYXmlFragment(blocks as any, fragment);
        });
      });
    } catch (err) {
      this.logger.warn(
        `Failed to update page status: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      userDid: taskMeta.userDid,
      matrixUserId: taskMeta.matrixUserId,
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
      userDid: taskMeta.userDid,
      roomId,
    };

    const deliverData: DeliverJobData = {
      taskId: taskMeta.taskId,
      userDid: taskMeta.userDid,
      matrixUserId: taskMeta.matrixUserId,
      roomId,
    };

    if (taskMeta.scheduleCron) {
      // Recurring flow — compute first work delay so it completes before the
      // first deliver fires.  Same formula as DeliverProcessor.scheduleNextWork:
      //   workDelay = nextCronTick − buffer − now   (clamped to 0)
      // When buffer ≥ interval the delay resolves to 0 (immediate), which is
      // correct — work starts right away since there isn't time for a full buffer.
      const bufferMs = taskMeta.bufferMinutes * 60_000;
      const interval = CronExpressionParser.parse(taskMeta.scheduleCron, {
        tz: taskMeta.timezone,
        currentDate: new Date(),
      });
      const firstDelivery = interval.next().toDate();
      const firstWorkDelay = resolveWorkDelay(
        firstDelivery.getTime(),
        bufferMs,
        this.logger,
        taskMeta.taskId,
      );
      const result = await this.scheduler.scheduleRecurringFlow({
        taskId: taskMeta.taskId,
        deliverData,
        repeat: { pattern: taskMeta.scheduleCron, tz: taskMeta.timezone },
        firstWork: {
          data: {
            ...workData,
            forDeliveryAt: firstDelivery.toISOString(),
          },
          delay: firstWorkDelay,
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
      const deliverAtMs = new Date(taskMeta.deadlineIso).getTime();
      const deliverDelay = deliverAtMs - Date.now();

      if (deliverDelay < 0) {
        throw new Error(
          `Task deadline is in the past: ${taskMeta.deadlineIso}`,
        );
      }

      const bufferMs = taskMeta.bufferMinutes * 60_000;
      const workDelay = resolveWorkDelay(
        deliverAtMs,
        bufferMs,
        this.logger,
        taskMeta.taskId,
      );

      const result = await this.scheduler.scheduleFlowJob({
        taskId: taskMeta.taskId,
        workData,
        deliverData,
        workDelay,
        deliverDelay,
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
