/**
 * TaskManager sub-agent tools — create_task, list_tasks, get_task_status.
 *
 * Factory function closes over dependencies so tools can call TasksService
 * without the LLM needing direct access.
 */

import { tool } from '@langchain/core/tools';
import type { StructuredTool } from 'langchain';
import { z } from 'zod';

import type { TasksService } from 'src/tasks/task.service';
import {
  DEFAULT_COMPLEXITY,
  DEFAULT_JOB_PATTERN,
  type ModelTier,
  type TaskType,
} from 'src/tasks/task-meta';
import { resolveModelForTask } from 'src/tasks/processors/processor-utils';

export interface TaskManagerToolsDeps {
  tasksService: TasksService;
  mainRoomId: string;
  userDid: string;
  matrixUserId: string;
  timezone: string;
  /** Workspace spaceId from the FE — stored in TaskMeta for editor access during execution */
  spaceId?: string;
}

const TASK_TYPES = [
  'reminder',
  'quick_lookup',
  'research',
  'report',
  'monitor',
  'scheduled_action',
] as const;

const TASK_STATUS_FILTER = [
  'active',
  'paused',
  'cancelled',
  'completed',
  'all',
] as const;

const NOTIFICATION_POLICIES = [
  'channel_only',
  'channel_and_mention',
  'silent',
  'on_threshold',
] as const;

export function createTaskManagerTools(
  deps: TaskManagerToolsDeps,
): StructuredTool[] {
  const { tasksService, mainRoomId, userDid, matrixUserId, timezone, spaceId } =
    deps;

  // ── create_task ──────────────────────────────────────────────────

  const createTask = tool(
    async (input) => {
      const taskType = input.taskType as TaskType;
      const complexity = input.complexityTier ?? DEFAULT_COMPLEXITY[taskType];
      const jobPattern = DEFAULT_JOB_PATTERN[taskType];
      const hasPage = input.createPage ?? jobPattern === 'flow';
      const channelType = input.channelType ?? 'main';
      const effectiveTimezone = input.timezone ?? timezone;

      const result = await tasksService.createTask({
        title: input.title,
        userDid,
        matrixUserId,
        mainRoomId,
        taskType,
        hasPage,
        channelType,
        timezone: effectiveTimezone,
        scheduleCron: input.scheduleCron,
        deadlineIso: input.deadlineIso,
        message: input.message,
        complexityTier: complexity,
        notificationPolicy: input.notificationPolicy ?? undefined,
        modelOverride: input.modelTier
          ? resolveModelForTask(input.modelTier as ModelTier, null).modelName
          : undefined,
        whatToDo: input.objective,
        howToReport: input.outputFormat,
        constraints: input.constraints,
        spaceId,
      });

      return JSON.stringify({
        taskId: result.taskId,
        title: input.title,
        status: result.taskMeta.status,
        channelType,
        roomId: result.roomId,
        nextRunAt: result.taskMeta.nextRunAt,
        hasPage,
      });
    },
    {
      name: 'create_task',
      description:
        'Creates a new scheduled task. Handles the full creation flow: generates a task ID, creates a Y.Doc with the taskMeta Y.Map (and optional Markdown page), creates a [Task]-prefixed Matrix room if the user chose a custom channel, schedules the BullMQ job (Simple Job for Pattern A, FlowProducer for Pattern B one-shot, repeatable deliver + one-shot work for Pattern B recurring), and updates the task index state event on the main channel. Call this once when you have all required details after negotiation.',
      schema: z.object({
        title: z
          .string()
          .describe('Human-readable task title, e.g. "Oil Price Monitor"'),
        objective: z
          .string()
          .describe(
            'What the agent should do — becomes the "What to Do" section',
          ),
        taskType: z
          .enum(TASK_TYPES)
          .describe(
            'Task classification: reminder (simple notification), quick_lookup (fast data fetch), research (deep investigation with page), report (periodic report with page), monitor (ongoing watch), scheduled_action (triggered workflow)',
          ),
        scheduleCron: z
          .string()
          .optional()
          .describe('Cron expression for recurring tasks, e.g. "0 9 * * *"'),
        deadlineIso: z
          .string()
          .optional()
          .describe(
            'ISO timestamp for one-shot tasks, e.g. "2026-03-20T17:00:00+02:00"',
          ),
        channelType: z
          .enum(['main', 'custom'])
          .optional()
          .describe(
            'Where results are delivered: "main" (current chat) or "custom" (dedicated room). Default: main.',
          ),
        createPage: z
          .boolean()
          .optional()
          .describe(
            'Whether to create a task page (Y.Doc). Default: false for reminders/quick_lookup, true for research/report/monitor/scheduled_action.',
          ),
        outputFormat: z
          .string()
          .optional()
          .describe('"How to Report" section content'),
        constraints: z
          .string()
          .optional()
          .describe('"Constraints" section content'),
        notificationPolicy: z
          .enum(NOTIFICATION_POLICIES)
          .optional()
          .describe(
            'Notification policy. Defaults: reminder→channel_and_mention, monitor→on_threshold, report→channel_only',
          ),
        modelTier: z
          .enum(['low', 'medium', 'high'])
          .optional()
          .describe('Model tier override. Default: derived from taskType'),
        timezone: z
          .string()
          .optional()
          .describe("Override timezone. Default: user's profile timezone"),
        message: z
          .string()
          .optional()
          .describe(
            'For Pattern A only — the literal message to send at the scheduled time',
          ),
        complexityTier: z
          .enum(['trivial', 'light', 'medium', 'heavy'])
          .optional()
          .describe(
            'Complexity tier override. Affects buffer time before delivery.',
          ),
      })
        .refine(
          (data) => {
            if (['reminder', 'monitor'].includes(data.taskType)) {
              return data.scheduleCron || data.deadlineIso;
            }
            return true;
          },
          {
            message:
              'Reminders and monitors require either scheduleCron or deadlineIso',
          },
        ),
    },
  );

  // ── list_tasks ───────────────────────────────────────────────────

  const listTasks = tool(
    async (input) => {
      const page = input.page ?? 0;
      const statusFilter = input.statusFilter;
      const needsFilter = statusFilter && statusFilter !== 'all';

      let tasks: Array<{
        taskId: string;
        title: string;
        status: string;
        taskType: string;
        channelType: string;
        roomId: string | null;
        nextRunAt: string | null;
        hasPage: boolean;
      }>;
      let total: number;

      if (needsFilter) {
        // Load all entries so we can filter before paginating
        const allResult = await tasksService.listTasks(mainRoomId, {
          page: 0,
          pageSize: 10_000,
        });
        const filtered = allResult.tasks.filter(
          (t) => t.status === statusFilter,
        );
        total = filtered.length;
        const pageSize = 20;
        const start = page * pageSize;
        tasks = filtered.slice(start, start + pageSize);
      } else {
        const result = await tasksService.listTasks(mainRoomId, { page });
        tasks = result.tasks;
        total = result.totalCount;
      }

      if (tasks.length === 0) {
        return JSON.stringify({ tasks: [], total: 0 });
      }

      return JSON.stringify({
        tasks: tasks.map((t) => ({
          taskId: t.taskId,
          title: t.title,
          status: t.status,
          taskType: t.taskType,
          channelType: t.channelType,
          roomId: t.roomId,
          nextRunAt: t.nextRunAt,
          hasPage: t.hasPage,
        })),
        total,
      });
    },
    {
      name: 'list_tasks',
      description:
        'Returns all tasks for the current user by reading the task index state event from the main agent channel. Returns an array of task summaries with status, type, channel info, next run time, and whether a page exists. Use when the user asks "what tasks do I have?", "show my tasks", "list my scheduled tasks", or to check if a task exists before modifying it.',
      schema: z.object({
        statusFilter: z
          .enum(TASK_STATUS_FILTER)
          .optional()
          .describe('Filter tasks by status. Default: active'),
        page: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Page number (0-based) for pagination'),
      }),
    },
  );

  // ── get_task_status ──────────────────────────────────────────────

  const getTaskStatus = tool(
    async (input) => {
      const meta = await tasksService.getTask({
        taskId: input.taskId,
        mainRoomId,
      });

      // Resolve human-readable title from the task index (TaskMeta doesn't store it)
      const indexEntry = await tasksService.getTaskIndexEntry(
        mainRoomId,
        input.taskId,
      );
      const title = indexEntry.title;

      return JSON.stringify({
        taskId: meta.taskId,
        title,
        status: meta.status,
        taskType: meta.taskType,
        jobPattern: meta.jobPattern,
        scheduleCron: meta.scheduleCron,
        deadlineIso: meta.deadlineIso,
        timezone: meta.timezone,
        nextRunAt: meta.nextRunAt,
        lastRunAt: meta.lastRunAt,
        totalRuns: meta.totalRuns,
        consecutiveFailures: meta.consecutiveFailures,
        totalTokensUsed: meta.totalTokensUsed,
        totalCostUsd: meta.totalCostUsd,
        monthlyBudgetUsd: meta.monthlyBudgetUsd,
        channelType: meta.channelType,
        roomId: meta.customRoomId,
        hasPage: meta.hasPage,
      });
    },
    {
      name: 'get_task_status',
      description:
        'Returns detailed status for a single task including scheduling info, execution history, and cost. For tasks with a Y.Map (page-based tasks), reads from the Y.Map. For page-less tasks, reads from the task list state event and BullMQ job metadata. Use when the user asks about a specific task: "how\'s my oil monitor doing?", "when does my digest run next?", "how much has my research task cost?". Also use before pause/resume/cancel to confirm the right task.',
      schema: z.object({
        taskId: z.string().describe('The task ID, e.g. "task_abc123"'),
      }),
    },
  );

  return [createTask, listTasks, getTaskStatus];
}
