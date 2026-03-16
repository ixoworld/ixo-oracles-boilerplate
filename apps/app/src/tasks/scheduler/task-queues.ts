/**
 * BullMQ Queue Definitions — Three queues for the two job patterns.
 *
 * Pattern A (Simple Job):  task:simple
 * Pattern B (Flow Job):    task:work + task:deliver
 *
 * @see spec §10.1 — Queues
 */

import type { DefaultJobOptions } from 'bullmq';

// ── Queue Names ──────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  SIMPLE: 'task_simple',
  WORK: 'task_work',
  DELIVER: 'task_deliver',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ── Default Job Options per Queue ────────────────────────────────────

const SEVEN_DAYS_SECONDS = 604_800;
const THIRTY_DAYS_SECONDS = 2_592_000;

export const QUEUE_DEFAULT_OPTIONS: Record<QueueName, DefaultJobOptions> = {
  [QUEUE_NAMES.SIMPLE]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 10_000 },
    removeOnComplete: { age: SEVEN_DAYS_SECONDS },
    removeOnFail: { age: THIRTY_DAYS_SECONDS },
  },
  [QUEUE_NAMES.WORK]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: SEVEN_DAYS_SECONDS },
    removeOnFail: { age: THIRTY_DAYS_SECONDS },
  },
  [QUEUE_NAMES.DELIVER]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: SEVEN_DAYS_SECONDS },
    removeOnFail: { age: THIRTY_DAYS_SECONDS },
  },
};

// ── Worker Concurrency ───────────────────────────────────────────────

export const WORKER_OPTIONS = {
  [QUEUE_NAMES.SIMPLE]: {
    concurrency: 20,
    lockDuration: 60_000,
  },
  [QUEUE_NAMES.WORK]: {
    concurrency: 5,
    limiter: { max: 3, duration: 60_000 },
    lockDuration: 300_000,
  },
  [QUEUE_NAMES.DELIVER]: {
    concurrency: 20,
    lockDuration: 60_000,
  },
} as const;
