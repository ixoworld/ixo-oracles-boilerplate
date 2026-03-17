/**
 * TaskTemplate registry — pre-configured defaults for common task patterns.
 *
 * Templates guide the TaskManager agent's negotiation: when a user's request
 * matches a template, the agent auto-applies these defaults and only asks
 * about fields that are still missing.
 *
 * Templates are referenced by the agent prompt and can be imported by tools
 * to fill in default values during task creation.
 *
 * @see spec §15 — Task Templates
 */

import type { TaskType } from '../task-meta';

// ── Template Interface ────────────────────────────────────────────────

export interface TaskTemplate {
  /** Unique key used in TASK_TEMPLATES map */
  id: string;
  /** Human-readable name shown in confirmations */
  displayName: string;
  taskType: TaskType;
  createPage: boolean;
  /** Whether to ask the user about a dedicated chat */
  suggestDedicatedChat: boolean;
  /** Default content for the "How to Report" page section */
  defaultOutputFormat: string;
  /** Default content for the "Constraints" page section */
  defaultConstraints: string;
  /** Natural language phrases that trigger this template */
  triggerPhrases: string[];
  /** Fields the agent must still ask the user for */
  missingFieldsToAsk: string[];
}

// ── Registry ─────────────────────────────────────────────────────────

export const TASK_TEMPLATES: Record<string, TaskTemplate> = {
  simple_reminder: {
    id: 'simple_reminder',
    displayName: 'Simple Reminder',
    taskType: 'reminder',
    createPage: false,
    suggestDedicatedChat: false,
    defaultOutputFormat: '',
    defaultConstraints: '',
    triggerPhrases: ['remind me', 'ping me', 'remind me to', 'alert me at'],
    missingFieldsToAsk: ['when'],
  },

  price_alert: {
    id: 'price_alert',
    displayName: 'Price Alert',
    taskType: 'monitor',
    createPage: true,
    suggestDedicatedChat: true,
    defaultOutputFormat:
      '2-3 sentences when threshold is crossed. Include current value, daily change, and source link. Skip silently if no threshold was crossed.',
    defaultConstraints:
      'Only alert when a threshold is crossed. Do not send "all clear" messages.',
    triggerPhrases: [
      'alert me when',
      'notify me when',
      'tell me when',
      'crosses',
      'drops below',
      'goes above',
      'reaches',
    ],
    missingFieldsToAsk: [
      'asset or metric',
      'threshold condition',
      'check interval',
    ],
  },

  research_task: {
    id: 'research_task',
    displayName: 'Research Task',
    taskType: 'research',
    createPage: true,
    suggestDedicatedChat: true,
    defaultOutputFormat:
      'Key findings (3-5 bullet points), followed by sources. End with a 1-sentence recommendation or conclusion.',
    defaultConstraints:
      'Cite sources. Prefer primary sources. Flag any conflicting information.',
    triggerPhrases: [
      'research',
      'investigate',
      'deep dive',
      'find out about',
      'look into',
    ],
    missingFieldsToAsk: ['topic', 'deadline'],
  },

  daily_digest: {
    id: 'daily_digest',
    displayName: 'Daily Digest',
    taskType: 'report',
    createPage: true,
    suggestDedicatedChat: true,
    defaultOutputFormat:
      'Top 5-7 bullet points with source links. Each bullet: one sentence max. Sort by relevance, not chronology.',
    defaultConstraints:
      'Use credible sources only. Skip duplicates or minor updates. Do not include opinion pieces unless explicitly requested.',
    triggerPhrases: [
      'every day',
      'every morning',
      'every evening',
      'daily',
      'each day',
      'daily summary',
      'daily digest',
      'daily rundown',
    ],
    missingFieldsToAsk: ['topic', 'delivery time (default: 9 AM)'],
  },

  weekly_report: {
    id: 'weekly_report',
    displayName: 'Weekly Report',
    taskType: 'report',
    createPage: true,
    suggestDedicatedChat: true,
    defaultOutputFormat:
      'Structured report with 3-5 named sections. Each section: 2-3 sentences and key numbers or data points. End with a 1-sentence "So what?" takeaway.',
    defaultConstraints:
      'Cover the full week, not just recent days. Highlight significant changes or anomalies. Include data sources.',
    triggerPhrases: [
      'every week',
      'weekly',
      'every monday',
      'once a week',
      'weekly report',
      'weekly summary',
      'weekly roundup',
    ],
    missingFieldsToAsk: [
      'topic',
      'delivery day and time (default: Monday 9 AM)',
    ],
  },

  recurring_check: {
    id: 'recurring_check',
    displayName: 'Recurring Check',
    taskType: 'monitor',
    createPage: true,
    suggestDedicatedChat: true,
    defaultOutputFormat:
      '2-3 sentences when condition is met. Include current state, change since last check, and source. Skip silently when condition is not met.',
    defaultConstraints:
      'Only report when the specified condition is met. Do not send "no change" messages.',
    triggerPhrases: [
      'check every',
      'monitor every',
      'watch for',
      'check every hour',
      'check every 30 minutes',
      'recurring check',
    ],
    missingFieldsToAsk: [
      'what to check',
      'condition or threshold',
      'check interval',
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Returns the default output format and constraints for a given task type.
 * Used by create_task as a code-level fallback when the agent doesn't pass
 * explicit values — ensures task pages always have meaningful content.
 */
export function getTemplateDefaults(taskType: string): {
  defaultOutputFormat: string;
  defaultConstraints: string;
} {
  const byType: Record<string, TaskTemplate> = {
    reminder: TASK_TEMPLATES.simple_reminder,
    quick_lookup: TASK_TEMPLATES.simple_reminder,
    research: TASK_TEMPLATES.research_task,
    report: TASK_TEMPLATES.daily_digest,
    monitor: TASK_TEMPLATES.price_alert,
    scheduled_action: TASK_TEMPLATES.research_task,
  };

  const template = byType[taskType];
  return {
    defaultOutputFormat: template?.defaultOutputFormat ?? '',
    defaultConstraints: template?.defaultConstraints ?? '',
  };
}

/**
 * Serialize all templates into a markdown section for the agent prompt.
 * Single source of truth — the prompt reads from data, not hardcoded text.
 */
export function buildTemplatePromptSection(): string {
  return Object.values(TASK_TEMPLATES)
    .map((t) => {
      const lines = [
        `**${t.displayName}**`,
        `- Triggers: ${t.triggerPhrases.map((p) => `"${p}"`).join(', ')}`,
        `- Defaults: ${t.suggestDedicatedChat ? 'dedicated chat' : 'current chat'}, ${t.createPage ? 'with page' : 'no page'}`,
      ];
      if (t.defaultOutputFormat) {
        lines.push(`- Output format: "${t.defaultOutputFormat}"`);
      }
      if (t.defaultConstraints) {
        lines.push(`- Constraints: "${t.defaultConstraints}"`);
      }
      lines.push(`- Ask: ${t.missingFieldsToAsk.join(', ')}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
