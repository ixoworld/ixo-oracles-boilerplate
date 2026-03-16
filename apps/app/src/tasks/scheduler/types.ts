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
  userId: string;
  roomId: string;
  message: string;
  messageType: 'reminder' | 'notification';
}

/** Data payload for Pattern B — Work child */
export interface WorkJobData {
  taskId: string;
  userId: string;
  roomId: string;
  /** ISO 8601 timestamp of the delivery this work prepares for (recurring only) */
  forDeliveryAt?: string;
}

/** Data payload for Pattern B — Deliver parent */
export interface DeliverJobData {
  taskId: string;
  userId: string;
  roomId: string;
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
  /** Date string suffix for job ID uniqueness, e.g. '2026-03-23' */
  dateSuffix: string;
}
