/**
 * Type definitions for the BullMQ scheduler.
 *
 * Job data payloads (what gets stored in Redis per job)
 * and scheduling parameter interfaces (what callers pass to TasksScheduler).
 *
 * @see spec §10 — BullMQ Job Design
 */

// Re-export QueueName from task-queues (derived from QUEUE_NAMES const)
export type { QueueName } from './task-queues';

// ── Job Data Payloads ────────────────────────────────────────────────

/** Data payload for Pattern A (Simple Job) */
export interface SimpleJobData {
  taskId: string;
  /** User DID, e.g. 'did:ixo:ixo1abc...' — used for room resolution and agent config */
  userDid: string;
  /** Matrix user ID, e.g. '@did-ixo-ixo1abc:ixo.world' — used for mentions and invites */
  matrixUserId: string;
  /**
   * Room id here will be the Custom RoomId if the task has a task page (Y.js Doc)
   * and will be mainAgent room if it's a normal quick task.
   *
   * @see {@link TasksService.scheduleTask} for how roomId is resolved (`taskMeta.customRoomId ?? params.mainRoomId`)
   */
  roomId: string;
  message: string;
  /** Human-readable task title for dashboard visibility */
  title?: string;
  /** Agent-classified task type (e.g. 'reminder', 'report') */
  taskType?: string;
  /** Cron pattern for recurring tasks, e.g. '0 9 * * 1' */
  scheduleCron?: string;
}

/** Data payload for Pattern B — Work child */
export interface WorkJobData {
  taskId: string;
  /** User DID — used for room resolution and agent config */
  userDid: string;
  /**
   * Room id here will be the Custom RoomId if the task has a task page (Y.js Doc)
   * and will be mainAgent room if it's a normal quick task.
   *
   * @see {@link TasksService.scheduleTask} for how roomId is resolved (`taskMeta.customRoomId ?? params.mainRoomId`)
   */
  roomId: string;
  /** ISO 8601 timestamp of the delivery this work prepares for (recurring only) */
  forDeliveryAt?: string;
  /** Human-readable task title for dashboard visibility */
  title?: string;
  /** Agent-classified task type (e.g. 'reminder', 'report') */
  taskType?: string;
  /** Cron pattern for recurring tasks, e.g. '0 9 * * 1' */
  scheduleCron?: string;
}

/** Data payload for Pattern B — Deliver parent */
export interface DeliverJobData {
  taskId: string;
  /** User DID — used for room resolution */
  userDid: string;
  /** Matrix user ID — used for mention pills in notifications */
  matrixUserId: string;
  roomId: string;
  /** Human-readable task title for dashboard visibility */
  title?: string;
  /** Agent-classified task type (e.g. 'reminder', 'report') */
  taskType?: string;
  /** Cron pattern for recurring tasks, e.g. '0 9 * * 1' */
  scheduleCron?: string;
}

/** Data payload for approval timeout/reminder jobs */
export interface ApprovalTimeoutJobData {
  taskId: string;
  userDid: string;
  matrixUserId: string;
  roomId: string;
  mainRoomId: string;
  /** Whether this is a reminder (24h) or final expiry (48h) */
  phase: 'reminder' | 'expiry';
}

// ── Scheduling Param Types ───────────────────────────────────────────

export interface ScheduleSimpleJobParams {
  taskId: string;
  data: SimpleJobData;
  /** Milliseconds from now until the job fires. Omit for repeatable-only. */
  delay?: number;
  /** Cron repeat config. Omit for one-shot. */
  repeat?: { pattern: string; tz: string };
}

export interface ScheduleFlowJobParams {
  taskId: string;
  workData: WorkJobData;
  deliverData: DeliverJobData;
  /** Milliseconds from now until the work child starts */
  workDelay: number;
  /** Milliseconds from now until the deliver parent fires */
  deliverDelay: number;
}

export interface ScheduleRecurringFlowParams {
  taskId: string;
  deliverData: DeliverJobData;
  /** Cron pattern + timezone for the repeatable deliver job */
  repeat: { pattern: string; tz: string };
  /** First work job to schedule (before the first delivery) */
  firstWork?: {
    data: WorkJobData;
    delay: number;
  };
}

export interface ScheduleNextWorkJobParams {
  taskId: string;
  data: WorkJobData;
  delay: number;
}

/** Params for scheduling an immediate retry flow (work→deliver) after rejection */
export interface ScheduleRetryFlowParams {
  taskId: string;
  workData: WorkJobData;
  deliverData: DeliverJobData;
}
