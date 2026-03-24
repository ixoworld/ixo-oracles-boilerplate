/**
 * TaskManager sub-agent tools — create_task, list_tasks, get_task_status,
 * pause_task, resume_task, cancel_task, update_task_schedule,
 * update_notification_policy.
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
import { getTemplateDefaults } from 'src/tasks/utils/template-registry';

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

      // Fall back to template defaults so pages are never blank
      const templateDefaults = getTemplateDefaults(taskType);

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
        howToReport: input.outputFormat ?? templateDefaults.defaultOutputFormat,
        constraints: input.constraints ?? templateDefaults.defaultConstraints,
        notes: input.notes,
        spaceId,
        requiresApproval: input.requiresApproval,
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
      schema: z
        .object({
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
          notes: z
            .string()
            .optional()
            .describe(
              'Optional freeform notes written into the task page. Use this for anything that will help when the task runs: which approach to take, what steps to follow, which agents or tools to prefer, edge cases to handle, or any other execution context the running agent should know. Leave empty if nothing extra is needed.',
            ),
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
          requiresApproval: z
            .boolean()
            .optional()
            .describe(
              'Whether results require user approval before delivery. Set to true when the user asks to "confirm", "review", "check with me", or "approve" results before they are sent.',
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

  // ── set_approval_gate ───────────────────────────────────────────

  const setApprovalGate = tool(
    async (input) => {
      await tasksService.updateTask({
        taskId: input.taskId,
        mainRoomId,
        updates: { requiresApproval: input.enabled },
      });

      return JSON.stringify({
        taskId: input.taskId,
        requiresApproval: input.enabled,
      });
    },
    {
      name: 'set_approval_gate',
      description:
        'Enables or disables the approval gate for a task. When enabled, the agent will ask the user to review and approve results before they are delivered. Use when the user says "check with me before sending", "I want to review before delivery", "confirm with me first", "get my approval", or similar. Also use to disable approval when the user says "no need to confirm anymore" or "just send it directly".',
      schema: z.object({
        taskId: z
          .string()
          .describe('The task ID to enable/disable approval for'),
        enabled: z
          .boolean()
          .describe('true to require approval, false to deliver automatically'),
      }),
    },
  );

  // ── pause_task ───────────────────────────────────────────────────

  const pauseTask = tool(
    async (input) => {
      try {
        const meta = await tasksService.pauseTask({
          taskId: input.taskId,
          mainRoomId,
        });
        const entry = await tasksService.getTaskIndexEntry(
          mainRoomId,
          input.taskId,
        );
        return JSON.stringify({
          taskId: meta.taskId,
          title: entry.title,
          status: meta.status,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'pause_task',
      description:
        'Pauses an active task. Removes all pending BullMQ jobs and sets the status to paused. The task schedule and page are preserved — the task can be resumed later from the same schedule. Use when the user says "pause", "stop for now", "suspend", or "put on hold". Do NOT use for permanent stops — use cancel_task instead. Call list_tasks or get_task_status first if you need to confirm the taskId.',
      schema: z.object({
        taskId: z.string().describe('The task ID to pause, e.g. "task_abc123"'),
      }),
    },
  );

  // ── resume_task ──────────────────────────────────────────────────

  const resumeTask = tool(
    async (input) => {
      try {
        const meta = await tasksService.resumeTask({
          taskId: input.taskId,
          mainRoomId,
        });
        const entry = await tasksService.getTaskIndexEntry(
          mainRoomId,
          input.taskId,
        );
        return JSON.stringify({
          taskId: meta.taskId,
          title: entry.title,
          status: meta.status,
          nextRunAt: meta.nextRunAt,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'resume_task',
      description:
        'Resumes a paused task. Re-creates BullMQ jobs from the task\'s existing schedule and sets status back to active. Use when the user says "resume", "restart", "turn it back on", or "unpause". Returns an error (do not retry silently) if the task is not paused, or if a one-shot task\'s deadline has already passed — in that case, tell the user the deadline passed and ask if they want to set a new one. Call list_tasks or get_task_status first if you need to confirm the taskId.',
      schema: z.object({
        taskId: z
          .string()
          .describe('The task ID to resume, e.g. "task_abc123"'),
      }),
    },
  );

  // ── cancel_task ──────────────────────────────────────────────────

  const cancelTask = tool(
    async (input) => {
      if (!input.confirmed) {
        return JSON.stringify({
          error:
            'Confirmation required. Ask the user to confirm before cancelling.',
        });
      }
      try {
        const meta = await tasksService.cancelTask({
          taskId: input.taskId,
          mainRoomId,
        });
        const entry = await tasksService.getTaskIndexEntry(
          mainRoomId,
          input.taskId,
        );
        return JSON.stringify({
          taskId: meta.taskId,
          title: entry.title,
          status: meta.status,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'cancel_task',
      description:
        'Permanently cancels a task. Removes all BullMQ jobs and marks the task as cancelled. The task page and chat history are preserved (room archival happens separately). This cannot be undone — you MUST confirm with the user before calling this tool, and pass confirmed: true. Use when the user says "cancel", "delete", "remove", "stop permanently", or "I don\'t need this anymore". For temporary stops, use pause_task instead.',
      schema: z.object({
        taskId: z
          .string()
          .describe('The task ID to cancel, e.g. "task_abc123"'),
        confirmed: z
          .boolean()
          .describe(
            'Must be true — only set this after the user has explicitly confirmed cancellation. Never call with false.',
          ),
      }),
    },
  );

  // ── update_task_schedule ─────────────────────────────────────────

  const updateTaskSchedule = tool(
    async (input) => {
      try {
        const updateParams: Parameters<typeof tasksService.updateTask>[0] = {
          taskId: input.taskId,
          mainRoomId,
          updates: {
            ...(input.newScheduleCron !== undefined
              ? { scheduleCron: input.newScheduleCron }
              : {}),
            ...(input.newDeadlineIso !== undefined
              ? { deadlineIso: input.newDeadlineIso }
              : {}),
          },
          newScheduleCron: input.newScheduleCron,
          newDeadlineIso: input.newDeadlineIso,
        };

        const meta = await tasksService.updateTask(updateParams);
        const entry = await tasksService.getTaskIndexEntry(
          mainRoomId,
          input.taskId,
        );
        return JSON.stringify({
          taskId: meta.taskId,
          title: entry.title,
          scheduleDescription: input.scheduleDescription,
          scheduleCron: meta.scheduleCron,
          deadlineIso: meta.deadlineIso,
          nextRunAt: meta.nextRunAt,
          status: meta.status,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'update_task_schedule',
      description:
        'Changes the schedule of an existing task. Cancels the current BullMQ jobs and creates new ones based on the new schedule. Works for both recurring tasks (new cron expression) and one-shot tasks (new deadline). Use when the user says "change it to every 2 hours", "reschedule to Tuesdays", "move the deadline to Friday", or gives any new timing. Parse the user\'s natural language into a cron expression or ISO timestamp before calling. Provide exactly one of newScheduleCron or newDeadlineIso — not both.',
      schema: z
        .object({
          taskId: z
            .string()
            .describe('The task ID to reschedule, e.g. "task_abc123"'),
          scheduleDescription: z
            .string()
            .describe(
              'Human-readable new schedule to confirm with the user, e.g. "every 2 hours" or "this Friday at 3 PM"',
            ),
          newScheduleCron: z
            .string()
            .optional()
            .describe(
              'New cron expression for a recurring task, e.g. "0 */2 * * *". Provide this OR newDeadlineIso, not both.',
            ),
          newDeadlineIso: z
            .string()
            .optional()
            .describe(
              'New ISO 8601 deadline for a one-shot task, e.g. "2026-03-25T15:00:00+02:00". Provide this OR newScheduleCron, not both.',
            ),
        })
        .refine(
          (data) =>
            data.newScheduleCron !== undefined ||
            data.newDeadlineIso !== undefined,
          { message: 'Provide either newScheduleCron or newDeadlineIso' },
        )
        .refine(
          (data) =>
            !(
              data.newScheduleCron !== undefined &&
              data.newDeadlineIso !== undefined
            ),
          { message: 'Provide newScheduleCron or newDeadlineIso, not both' },
        ),
    },
  );

  // ── update_notification_policy ──────────────────────────────────────

  const updateNotificationPolicy = tool(
    async (input) => {
      try {
        const meta = await tasksService.updateTask({
          taskId: input.taskId,
          mainRoomId,
          updates: { notificationPolicy: input.policy },
        });
        const entry = await tasksService.getTaskIndexEntry(
          mainRoomId,
          input.taskId,
        );

        const policyDescriptions: Record<string, string> = {
          channel_only: 'post results without push notification',
          channel_and_mention: 'post results and send a push notification',
          silent: 'save results to the task page only, no messages',
          on_threshold: 'only post when a condition or threshold is met',
        };

        return JSON.stringify({
          taskId: meta.taskId,
          title: entry.title,
          notificationPolicy: meta.notificationPolicy,
          description: policyDescriptions[meta.notificationPolicy],
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'update_notification_policy',
      description:
        'Changes how the user gets notified about task results. Use when the user says "make it silent", "notify me with a push", "only alert me when the threshold is hit", "stop sending me notifications for this", or any change to notification behavior.',
      schema: z.object({
        taskId: z
          .string()
          .describe('The task ID to update, e.g. "task_abc123"'),
        policy: z
          .enum(NOTIFICATION_POLICIES)
          .describe(
            'New notification policy: "channel_only" (post, no push), "channel_and_mention" (post + push), "silent" (page only), "on_threshold" (post only when condition met)',
          ),
      }),
    },
  );

  return [
    createTask,
    listTasks,
    getTaskStatus,
    setApprovalGate,
    pauseTask,
    resumeTask,
    cancelTask,
    updateTaskSchedule,
    updateNotificationPolicy,
  ];
}
