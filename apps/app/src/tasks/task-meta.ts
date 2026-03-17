/**
 * TaskMeta — Y.Map sidecar schema for scheduled tasks.
 *
 * Every task has a Y.Doc with two top-level entries:
 *   - content: Y.XmlFragment  (Markdown page, if hasPage is true)
 *   - taskMeta: Y.Map          (this schema)
 *
 * All technical metadata lives here — never in Markdown frontmatter.
 * Y.Map is CRDT-native: each key is an independent register, so concurrent
 * edits (user editing page + backend updating nextRunAt) never corrupt each other.
 *
 * @see spec §6.2 — Y.Map Schema
 */

// ── Enums / Literals ────────────────────────────────────────────────

export type TaskType =
  | 'reminder'
  | 'quick_lookup'
  | 'research'
  | 'report'
  | 'monitor'
  | 'scheduled_action';

export type JobPattern = 'simple' | 'flow';

export type TaskStatus =
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'dry_run';

export type ComplexityTier = 'trivial' | 'light' | 'medium' | 'heavy';

export type ModelTier = 'low' | 'medium' | 'high';

export type ChannelType = 'main' | 'custom';

export type NotificationPolicy =
  | 'channel_only'
  | 'channel_and_mention'
  | 'silent'
  | 'on_threshold';

// ── TaskMeta Interface ──────────────────────────────────────────────

export interface TaskMeta {
  // ── Identity ──────────────────────────────────────────────────────
  /** Unique task identifier, e.g. 'task_abc123' */
  taskId: string;
  /** User DID, e.g. 'did:ixo:ixo1abc...' */
  userDid: string;
  /** Matrix user ID for room operations, e.g. '@did-ixo-ixo1abc:ixo.world' */
  matrixUserId: string;
  /** Agent-classified task type — drives pattern selection and defaults */
  taskType: TaskType;
  /** Whether a Markdown page exists for this task */
  hasPage: boolean;

  // ── Scheduling ────────────────────────────────────────────────────
  /** Cron pattern for recurring tasks, e.g. '0 9 * * 1'. Null for one-shot. */
  scheduleCron: string | null;
  /** ISO 8601 deadline for one-shot tasks. Null for recurring. */
  deadlineIso: string | null;
  /** IANA timezone, e.g. 'Africa/Cairo' */
  timezone: string;
  /** Minutes before delivery to start the work phase */
  bufferMinutes: number;

  // ── BullMQ References ─────────────────────────────────────────────
  /** Which BullMQ pattern this task uses */
  jobPattern: JobPattern;
  /** BullMQ job ID, e.g. 'task_abc123-simple' or 'task_abc123-deliver' */
  bullmqJobId: string;
  /** Key for cancelling repeatable jobs. Null for one-shot. */
  bullmqRepeatKey: string | null;
  /** Current work job ID for recurring flows. Updated each cycle by deliver processor. */
  currentWorkJobId: string | null;

  // ── State ─────────────────────────────────────────────────────────
  /** Current lifecycle status */
  status: TaskStatus;
  /** Set to true when the user edits the page content; next run picks up changes */
  needsReplan: boolean;

  // ── Execution Tracking ────────────────────────────────────────────
  /** Estimated complexity — drives buffer defaults, self-adjusts after each run */
  complexityTier: ComplexityTier;
  /** ISO 8601 timestamp of last completed run. Null if never run. */
  lastRunAt: string | null;
  /** ISO 8601 timestamp of next scheduled run. Null if paused/completed. */
  nextRunAt: string | null;
  /** Total number of completed runs */
  totalRuns: number;
  /** Consecutive failures — auto-pause at 5 (§22.1) */
  consecutiveFailures: number;

  // ── Cost Tracking (§13) ───────────────────────────────────────────
  /** Cumulative token usage across all runs */
  totalTokensUsed: number;
  /** Cumulative cost in USD */
  totalCostUsd: number;
  /** Monthly budget cap. Null = no limit. Auto-pause when exceeded. */
  monthlyBudgetUsd: number | null;

  // ── Model Selection (§19) ─────────────────────────────────────────
  /** Default model tier based on task type */
  modelTier: ModelTier;
  /** User override for a specific model. Null = use tier default. */
  modelOverride: string | null;

  // ── Channel & Notification ────────────────────────────────────────
  /** Whether results go to the main channel or a dedicated task room */
  channelType: ChannelType;
  /** Matrix room ID for dedicated task channel. Null if channelType is 'main'. */
  customRoomId: string | null;
  /** How the user gets notified about results */
  notificationPolicy: NotificationPolicy;

  // ── Approval Gate (§14) ───────────────────────────────────────────
  /** Whether results require user approval before delivery */
  requiresApproval: boolean;
  /** Matrix event ID of the pending approval message. Null if not pending. */
  pendingApprovalEventId: string | null;

  // ── Dependencies (§12) ────────────────────────────────────────────
  /** Task IDs this task depends on (linear chain, max depth 5) */
  dependsOn: string[];
  /** Task ID that triggered this run (if dependency-based) */
  triggeredBy: string | null;

  // ── Editor Context ──────────────────────────────────────────────
  /** Workspace spaceId — enables standalone editor access during task execution */
  spaceId: string | null;

  // ── Recent Output ───────────────────────────────────────────────
  /** Last N output rows, stored in metadata so user page edits can't corrupt them */
  recentOutput: OutputRow[];

  // ── Timestamps ────────────────────────────────────────────────────
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
}

// ── Output Row ───────────────────────────────────────────────────────

export interface OutputRow {
  /** Display date, e.g. "Mar 16, 2:30 PM" */
  when: string;
  /** One-line summary of the run result */
  summary: string;
  /** Matrix message link, e.g. "#msg-eventId1" */
  link: string;
}

// ── Defaults ────────────────────────────────────────────────────────

/** Default model tier per task type */
export const DEFAULT_MODEL_TIER: Record<TaskType, ModelTier> = {
  reminder: 'low',
  quick_lookup: 'low',
  research: 'high',
  report: 'high',
  monitor: 'medium',
  scheduled_action: 'medium',
};

/** Default job pattern per task type */
export const DEFAULT_JOB_PATTERN: Record<TaskType, JobPattern> = {
  reminder: 'simple',
  quick_lookup: 'simple',
  research: 'flow',
  report: 'flow',
  monitor: 'flow',
  scheduled_action: 'flow',
};

/** Default notification policy per task type */
export const DEFAULT_NOTIFICATION_POLICY: Record<TaskType, NotificationPolicy> =
  {
    reminder: 'channel_and_mention',
    quick_lookup: 'channel_and_mention',
    research: 'channel_only',
    report: 'channel_only',
    monitor: 'on_threshold',
    scheduled_action: 'channel_only',
  };

/** Buffer minutes per complexity tier (§10.5) */
export const BUFFER_MINUTES: Record<ComplexityTier, number> = {
  trivial: 2,
  light: 10,
  medium: 30,
  heavy: 60,
};

/** Default complexity tier per task type */
export const DEFAULT_COMPLEXITY: Record<TaskType, ComplexityTier> = {
  reminder: 'trivial',
  quick_lookup: 'trivial',
  research: 'medium',
  report: 'medium',
  monitor: 'light',
  scheduled_action: 'light',
};
