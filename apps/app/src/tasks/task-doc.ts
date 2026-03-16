/**
 * Task Y.Doc Structure
 *
 * Each task has a Y.Doc with a `taskMeta` Y.Map sidecar.
 *
 * For tasks WITH a page, the editor owns the Y.Doc structure
 * (root, title, document, etc.) — we only write our `taskMeta` map
 * into the existing doc via `writeTaskMetaToDoc()`.
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
 * Read the full TaskMeta from a Y.Doc's taskMeta map.
 * Returns undefined for any missing keys (partial reads are safe).
 */
export function readTaskMeta(doc: Y.Doc): TaskMeta {
  const map = getTaskMetaMap(doc);
  return Object.fromEntries(map.entries()) as unknown as TaskMeta;
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
  userId: string;
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
  requiresApproval?: boolean;
  dependsOn?: string[];
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
    userId: params.userId,
    taskType: params.taskType,
    hasPage: params.hasPage,

    // Scheduling
    scheduleCron: params.scheduleCron ?? null,
    deadlineIso: params.deadlineIso ?? null,
    timezone: params.timezone,
    bufferMinutes: BUFFER_MINUTES[complexity],

    // BullMQ references (set by TasksScheduler after job creation)
    jobPattern: DEFAULT_JOB_PATTERN[params.taskType],
    bullmqJobId: '',
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
    notificationPolicy: DEFAULT_NOTIFICATION_POLICY[params.taskType],

    // Approval gate
    requiresApproval: params.requiresApproval ?? false,
    pendingApprovalEventId: null,

    // Dependencies
    dependsOn: params.dependsOn ?? [],
    triggeredBy: null,

    // Recent output (rendered to page markdown, safe from user edits)
    recentOutput: [],

    // Timestamps
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Write the full TaskMeta into an existing Y.Doc (e.g. one owned by the editor).
 * Use this for tasks WITH pages — the caller gets the doc from the editor,
 * and we just write our `taskMeta` Y.Map into it.
 */
export function writeTaskMetaToDoc(doc: Y.Doc, meta: TaskMeta): void {
  updateTaskMeta(doc, meta);
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
  const existing = (map.get('recentOutput') as OutputRow[] | undefined) ?? [];
  const updated = [row, ...existing].slice(0, MAX_RECENT_OUTPUT_ROWS);
  doc.transact(() => {
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
