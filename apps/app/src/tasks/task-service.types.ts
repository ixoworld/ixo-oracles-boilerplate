/**
 * Type definitions for TasksService.
 *
 * State event types, index entries, and CRUD parameter interfaces.
 */

import type {
  ChannelType,
  ComplexityTier,
  NotificationPolicy,
  TaskMeta,
  TaskStatus,
  TaskType,
} from './task-meta';

// ── State Event Constants ───────────────────────────────────────────

/** Per-task state event type (simple tasks without pages) */
export const TASK_STATE_EVENT_TYPE = 'ixo.ora.task.meta';

/** Task list index state event type (all tasks) */
export const TASKS_INDEX_EVENT_TYPE = 'ixo.ora.tasks.index';

// ── Constants ──────────────────────────────────────────────────────

/** Max entries per index chunk event */
export const DEFAULT_CHUNK_SIZE = 100;

/** Default page size for listTasks pagination */
export const DEFAULT_PAGE_SIZE = 20;

// ── Types ───────────────────────────────────────────────────────────

/** Entry in the task index state event */
export interface TaskIndexEntry {
  taskId: string;
  title: string;
  status: TaskStatus;
  taskType: TaskType;
  channelType: ChannelType;
  roomId: string | null;
  roomAlias: string | null;
  nextRunAt: string | null;
  hasPage: boolean;
}

/**
 * Header event for the chunked task index.
 * Event type: `ixo.ora.tasks.index`, state key: `''`
 */
export interface TasksIndexHeader {
  totalCount: number;
  chunkSize: number;
  chunkCount: number;
  updatedAt: string;
  /** Quick lookup: taskId → chunk number */
  taskChunkMap: Record<string, number>;
}

/**
 * A single chunk of the task index.
 * Event type: `ixo.ora.tasks.index`, state key: `'chunk:0'`, `'chunk:1'`, etc.
 * Keyed by taskId, max `chunkSize` entries per chunk.
 */
export type TasksIndexChunk = Record<string, TaskIndexEntry>;

/** Options for paginated task listing */
export interface ListTasksOptions {
  /** Page number (0-based). Defaults to 0. */
  page?: number;
  /** Number of entries per page. Defaults to DEFAULT_PAGE_SIZE (20). */
  pageSize?: number;
}

/** Paginated result from listTasks */
export interface ListTasksResult {
  tasks: TaskIndexEntry[];
  totalCount: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Input params for creating a task */
export interface CreateTaskParams {
  title: string;
  userDid: string;
  matrixUserId: string;
  mainRoomId: string;
  taskType: TaskType;
  hasPage: boolean;
  channelType: ChannelType;
  timezone: string;

  // Scheduling
  scheduleCron?: string;
  deadlineIso?: string;

  // Page content (only when hasPage: true)
  scheduleDescription?: string;
  whatToDo?: string;
  howToReport?: string;
  constraints?: string;

  // Simple job message (only for pattern A)
  message?: string;

  // Optional overrides
  complexityTier?: ComplexityTier;
  monthlyBudgetUsd?: number;
  modelOverride?: string;
  notificationPolicy?: NotificationPolicy;
  requiresApproval?: boolean;
  dependsOn?: string[];
  inviteUserIds?: string[];

  // Editor context
  spaceId?: string;
}

/** Params for getting a single task */
export interface GetTaskParams {
  taskId: string;
  mainRoomId: string;
}

/** Params for updating a task */
export interface UpdateTaskParams {
  taskId: string;
  mainRoomId: string;
  updates: Partial<TaskMeta>;
  /** New schedule (will cancel old jobs and reschedule) */
  newScheduleCron?: string;
  newDeadlineIso?: string;
}

/** Params for deleting a task */
export interface DeleteTaskParams {
  taskId: string;
  mainRoomId: string;
}

/** Result from createTask */
export interface CreateTaskResult {
  taskId: string;
  taskMeta: TaskMeta;
  roomId: string | null;
  roomAlias: string | null;
}
