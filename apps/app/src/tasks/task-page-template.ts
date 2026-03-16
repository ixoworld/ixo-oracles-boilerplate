/**
 * Task Page Markdown Template
 *
 * Generates a clean Markdown page from task parameters.
 * The page is user-editable — no YAML frontmatter, no technical IDs.
 * All machine data lives in the Y.Map sidecar (taskMeta).
 *
 * @see spec §5.2 — Page Template
 */

import type { ChannelType, OutputRow, TaskMeta, TaskType } from './task-meta';

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

  sections.push(
    '',
    '---',
    '',
    '## Recent Output',
    '',
    '| When | Summary | Link |',
    '|------|---------|------|',
  );

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
    status: '\u2705 Active',
    whatToDo: input.whatToDo,
    howToReport: input.howToReport,
    constraints: input.constraints,
  };
}

// ── Output Table (rendered from metadata) ────────────────────────────

/**
 * Renders the "Recent Output" Markdown table from the taskMeta's
 * `recentOutput` array. Because output rows live in metadata (not in
 * the page markdown), user edits to the page can never corrupt them.
 *
 * Keeps the last `maxRows` entries (default 5).
 */
export function formatOutputTable(meta: TaskMeta, maxRows = 5): string {
  const header = '| When | Summary | Link |\n|------|---------|------|';
  const rows = (meta.recentOutput ?? []).slice(0, maxRows);
  const body = rows
    .map(
      (row: OutputRow) =>
        `| ${row.when} | ${row.summary} | [View](${row.link}) |`,
    )
    .join('\n');

  return `${header}\n${body}`;
}
