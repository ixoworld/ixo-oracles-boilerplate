/**
 * Task Y.Doc Structure
 *
 * Each task has a Y.Doc with a `taskMeta` Y.Map sidecar.
 *
 * For tasks WITH a page, the editor owns the Y.Doc structure
 * (root, title, document, etc.) — we only write our `taskMeta` map
 * into the existing doc via `updateTaskMeta()`.
 *
 * For tasks WITHOUT a page (reminders, quick lookups), metadata is
 * stored as a Matrix state event on the main room — no Y.Doc needed.
 *
 * The `taskMeta` key doesn't overlap with editor keys:
 * root, title, document, flow, runtime, delegations, invocations, auditTrail
 *
 * @see spec §6.1 — Architecture
 */

import type * as Y from 'yjs';

import {
  BUFFER_MINUTES,
  DEFAULT_COMPLEXITY,
  DEFAULT_JOB_PATTERN,
  DEFAULT_MODEL_TIER,
  DEFAULT_NOTIFICATION_POLICY,
  type ChannelType,
  type ComplexityTier,
  type NotificationPolicy,
  type OutputRow,
  type TaskMeta,
  type TaskType,
} from './task-meta';

// ── Y.Doc Key Names ─────────────────────────────────────────────────

/** Top-level Y.Doc key for the task metadata sidecar (Y.Map) */
export const YDOC_TASK_META_KEY = 'taskMeta';

// ── Accessors ───────────────────────────────────────────────────────

/** Get the Y.Map for task metadata */
export function getTaskMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(YDOC_TASK_META_KEY);
}

// ── Read / Write Helpers ────────────────────────────────────────────

/**
 * Build a TaskMeta with safe defaults for all fields.
 * Used as a base when reading from Y.Map to ensure no undefined fields.
 */
function buildDefaultTaskMeta(): TaskMeta {
  return {
    taskId: '',
    userDid: '',
    matrixUserId: '',
    taskType: 'reminder',
    hasPage: false,
    scheduleCron: null,
    deadlineIso: null,
    timezone: '',
    bufferMinutes: 0,
    jobPattern: 'simple',
    bullmqJobId: null,
    bullmqRepeatKey: null,
    currentWorkJobId: null,
    status: 'active',
    needsReplan: false,
    complexityTier: 'trivial',
    lastRunAt: null,
    nextRunAt: null,
    totalRuns: 0,
    consecutiveFailures: 0,
    totalTokensUsed: 0,
    totalCostUsd: 0,
    monthlyBudgetUsd: null,
    modelTier: 'low',
    modelOverride: null,
    channelType: 'main',
    customRoomId: null,
    notificationPolicy: 'channel_only',
    requiresApproval: false,
    pendingApprovalEventId: null,
    lastRejectionReason: null,
    lastRejectionAt: null,
    rejectionCount: 0,
    dependsOn: [],
    triggeredBy: null,
    spaceId: null,
    recentOutput: [],
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Read the full TaskMeta from a Y.Doc's taskMeta map.
 * Merges Y.Map entries over safe defaults to ensure all fields are present.
 */
export function readTaskMeta(doc: Y.Doc): TaskMeta {
  const map = getTaskMetaMap(doc);
  const raw = Object.fromEntries(map.entries());
  return { ...buildDefaultTaskMeta(), ...raw };
}

/**
 * Write a partial TaskMeta update into the Y.Doc's taskMeta map.
 * Only the provided keys are updated — other keys are untouched.
 * Wraps the update in a Y.Doc transaction for atomicity.
 */
export function updateTaskMeta(doc: Y.Doc, updates: Partial<TaskMeta>): void {
  const map = getTaskMetaMap(doc);
  doc.transact(() => {
    for (const [key, value] of Object.entries(updates)) {
      map.set(key, value);
    }
  });
}

// ── Initialization ──────────────────────────────────────────────────

export interface CreateTaskMetaParams {
  taskId: string;
  userDid: string;
  matrixUserId: string;
  taskType: TaskType;
  hasPage: boolean;

  // Scheduling — at least one of these
  scheduleCron?: string;
  deadlineIso?: string;
  timezone: string;

  // Channel
  channelType: ChannelType;
  customRoomId?: string;

  // Optional overrides
  complexityTier?: ComplexityTier;
  monthlyBudgetUsd?: number;
  modelOverride?: string;
  notificationPolicy?: NotificationPolicy;
  requiresApproval?: boolean;
  dependsOn?: string[];

  // Editor context
  spaceId?: string;
}

/**
 * Build a complete TaskMeta object from creation params,
 * applying defaults based on task type.
 */
export function buildTaskMeta(params: CreateTaskMetaParams): TaskMeta {
  const complexity =
    params.complexityTier ?? DEFAULT_COMPLEXITY[params.taskType];
  const now = new Date().toISOString();

  return {
    // Identity
    taskId: params.taskId,
    userDid: params.userDid,
    matrixUserId: params.matrixUserId,
    taskType: params.taskType,
    hasPage: params.hasPage,

    // Scheduling
    scheduleCron: params.scheduleCron ?? null,
    deadlineIso: params.deadlineIso ?? null,
    timezone: params.timezone,
    bufferMinutes: BUFFER_MINUTES[complexity],

    // BullMQ references (set by TasksScheduler after job creation)
    jobPattern: DEFAULT_JOB_PATTERN[params.taskType],
    bullmqJobId: null,
    bullmqRepeatKey: null,
    currentWorkJobId: null,

    // State
    status: 'active',
    needsReplan: false,

    // Execution tracking
    complexityTier: complexity,
    lastRunAt: null,
    nextRunAt: null,
    totalRuns: 0,
    consecutiveFailures: 0,

    // Cost tracking
    totalTokensUsed: 0,
    totalCostUsd: 0,
    monthlyBudgetUsd: params.monthlyBudgetUsd ?? null,

    // Model selection
    modelTier: DEFAULT_MODEL_TIER[params.taskType],
    modelOverride: params.modelOverride ?? null,

    // Channel & notification
    channelType: params.channelType,
    customRoomId: params.customRoomId ?? null,
    notificationPolicy:
      params.notificationPolicy ?? DEFAULT_NOTIFICATION_POLICY[params.taskType],

    // Approval gate
    requiresApproval: params.requiresApproval ?? false,
    pendingApprovalEventId: null,
    lastRejectionReason: null,
    lastRejectionAt: null,
    rejectionCount: 0,

    // Dependencies
    dependsOn: params.dependsOn ?? [],
    triggeredBy: null,

    // Editor context
    spaceId: params.spaceId ?? null,

    // Recent output (rendered to page markdown, safe from user edits)
    recentOutput: [],

    // Timestamps
    createdAt: now,
    updatedAt: now,
  };
}

// ── Output Row Helper ────────────────────────────────────────────────

const MAX_RECENT_OUTPUT_ROWS = 5;

/**
 * Append an output row to the taskMeta's `recentOutput` array.
 * Keeps only the last `MAX_RECENT_OUTPUT_ROWS` entries.
 * Reads current rows from the Y.Map, prepends the new row, trims, and writes back.
 */
export function appendOutputRow(doc: Y.Doc, row: OutputRow): void {
  const map = getTaskMetaMap(doc);
  doc.transact(() => {
    const raw = map.get('recentOutput');
    const existing: OutputRow[] = Array.isArray(raw) ? raw : [];
    const updated = [row, ...existing].slice(0, MAX_RECENT_OUTPUT_ROWS);
    map.set('recentOutput', updated);
    map.set('updatedAt', new Date().toISOString());
  });
}

// ── Task ID Generation ──────────────────────────────────────────────

/**
 * Generate a unique task ID with the `task_` prefix.
 * Uses crypto.randomUUID for uniqueness.
 */
export function generateTaskId(): string {
  return `task_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
