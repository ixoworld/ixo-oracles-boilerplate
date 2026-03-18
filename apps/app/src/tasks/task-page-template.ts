/**
 * Task Page Markdown Template
 *
 * Generates a clean Markdown page from task parameters.
 * The page is user-editable — no YAML frontmatter, no technical IDs.
 * All machine data lives in the Y.Map sidecar (taskMeta).
 *
 * @see spec §5.2 — Page Template
 */

import type {
  ChannelType,
  OutputRow,
  TaskMeta,
  TaskStatus,
  TaskType,
} from './task-meta';

// ── Template Input ──────────────────────────────────────────────────

export interface TaskPageParams {
  /** Human-readable task title, e.g. "Oil Price Monitor" */
  title: string;
  /** Plain English schedule, e.g. "Every 30 minutes during London market hours" */
  scheduleDescription: string;
  /** Channel display name — either "Main chat" or "[Task] <title>" */
  channelName: string;
  /** Current status emoji + label */
  status: string;
  /** What the agent should do — the task prompt */
  whatToDo: string;
  /** How results should be formatted */
  howToReport: string;
  /** Optional constraints / rules */
  constraints?: string;
  /** Optional freeform notes — agent or user can add anything useful: approach hints, sub-agent suggestions, steps to follow, edge-case handling, etc. */
  notes?: string;
}

// ── Template Function ───────────────────────────────────────────────

/**
 * Generates a Markdown task page from the given parameters.
 *
 * Sections:
 * - Title (h1)
 * - Header: Schedule, Channel, Status (bold key-value)
 * - "What to Do" — the task prompt the agent reads at execution time
 * - "How to Report" — output format the agent follows
 * - "Constraints" — optional rules (omitted if empty)
 * - "Recent Output" — agent-managed table (starts empty)
 */
export function generateTaskPage(params: TaskPageParams): string {
  const sections: string[] = [
    `# ${params.title}`,
    '',
    `**Schedule:** ${params.scheduleDescription}  `,
    `**Channel:** ${params.channelName}  `,
    `**Status:** ${params.status}`,
    '',
    '---',
    '',
    '## What to Do',
    '',
    params.whatToDo,
    '',
    '## How to Report',
    '',
    params.howToReport,
  ];

  if (params.constraints) {
    sections.push('', '## Constraints', '', params.constraints);
  }

  if (params.notes) {
    sections.push('', '## Notes', '', params.notes);
  }

  sections.push('', '---', '', '## Recent Output', '', '*No output yet.*');

  return sections.join('\n');
}

// ── Convenience: Build params from task data ────────────────────────

export interface TaskPageInput {
  title: string;
  taskType: TaskType;
  channelType: ChannelType;
  scheduleDescription: string;
  whatToDo: string;
  howToReport: string;
  constraints?: string;
  notes?: string;
}

/**
 * Builds a `TaskPageParams` object from higher-level task data,
 * applying sensible defaults for status and channel display.
 */
export function buildTaskPageParams(input: TaskPageInput): TaskPageParams {
  const channelName =
    input.channelType === 'custom' ? `[Task] ${input.title}` : 'Main chat';

  return {
    title: input.title,
    scheduleDescription: input.scheduleDescription,
    channelName,
    status: formatStatusLabel('active'),
    whatToDo: input.whatToDo,
    howToReport: input.howToReport,
    constraints: input.constraints,
    notes: input.notes,
  };
}

// ── Status Label ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  active: '\u2705 Active',
  paused: '\u23F8\uFE0F Paused',
  cancelled: '\u274C Cancelled',
  completed: '\u2705 Completed',
  dry_run: '\uD83E\uDDEA Dry Run',
};

/** Returns an emoji + label for a given task status. */
export function formatStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}

// ── Output Section (rendered from metadata) ──────────────────────────

/**
 * Renders the "Recent Output" section as a release-notes style list
 * from the taskMeta's `recentOutput` array. Each entry is a bold
 * timestamp, a dash, a one-line summary, and an optional view link.
 *
 * Keeps the last `maxRows` entries (default 5).
 */
export function formatOutputSection(meta: TaskMeta, maxRows = 5): string {
  const rows = (meta.recentOutput ?? []).slice(0, maxRows);
  if (rows.length === 0) return '*No output yet.*';
  return rows
    .map((row: OutputRow) => {
      const link = row.link ? ` — [View](${row.link})` : '';
      return `**${row.when}** — ${row.summary}${link}`;
    })
    .join('\n\n');
}
