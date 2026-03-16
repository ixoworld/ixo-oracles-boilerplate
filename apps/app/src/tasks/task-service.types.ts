/**
 * Type definitions for TasksService.
 *
 * State event types, index entries, and CRUD parameter interfaces.
 */

import type {
  ChannelType,
  ComplexityTier,
  TaskMeta,
  TaskStatus,
  TaskType,
} from './task-meta';

// ── State Event Constants ───────────────────────────────────────────

/** Per-task state event type (simple tasks without pages) */
export const TASK_STATE_EVENT_TYPE = 'ixo.ora.task.meta';

/** Task list index state event type (all tasks) */
export const TASKS_INDEX_EVENT_TYPE = 'ixo.ora.tasks.index';

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

/** Content of the `ixo.ora.tasks.index` state event */
export interface TasksIndexContent {
  tasks: TaskIndexEntry[];
  updatedAt: string;
}

/** Input params for creating a task */
export interface CreateTaskParams {
  title: string;
  userId: string;
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
  requiresApproval?: boolean;
  dependsOn?: string[];
  inviteUserIds?: string[];
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
