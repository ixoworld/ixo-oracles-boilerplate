/**
 * WorkProcessor — Pattern B work child processor.
 *
 * Invokes the AI agent to perform the task's work. Reads task page
 * instructions (if hasPage), builds a prompt, and calls MainAgentGraph.sendMessage().
 * Returns a WorkResult that the deliver processor picks up.
 *
 * @see spec §10.3 — Flow Job (Work Child)
 */

import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { Cache } from 'cache-manager';
import { AIMessageChunk } from 'langchain';

import { MainAgentGraph } from 'src/graph';
import { OPENID_CACHE_PREFIX } from 'src/middleware/auth-header.middleware';
import type { ENV } from 'src/types';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';

import { TokenLimiter } from 'src/utils/token-limit-handler';
import { decryptToken } from '../token-encryption';

import crypto from 'node:crypto';
import { QUEUE_NAMES, WORKER_OPTIONS } from '../scheduler/task-queues';
import type { WorkJobData } from '../scheduler/types';
import { sharedServerEditor, withTaskDoc } from '../task-doc-helpers';
import type { TaskMeta } from '../task-meta';
import { TasksService } from '../task.service';
import {
  WorkJobDataSchema,
  formatOutputDate,
  handleJobFailure,
  isTaskRunnable,
  resolveMainRoomId,
  resolveModelForTask,
  truncateText,
  type TaskExecutionContext,
  type WorkResult,
} from './processor-utils';

@Processor(QUEUE_NAMES.WORK, WORKER_OPTIONS[QUEUE_NAMES.WORK])
export class WorkProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkProcessor.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly config: ConfigService<ENV>,
    @Inject('MAIN_AGENT_GRAPH') private readonly mainAgent: MainAgentGraph,
    private readonly syncService: UserMatrixSqliteSyncService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    super();
  }

  async process(job: Job<WorkJobData>): Promise<WorkResult> {
    WorkJobDataSchema.parse(job.data);

    const { taskId, userDid, roomId } = job.data;
    this.logger.log(
      `Processing work job for task ${taskId} [jobId=${job.id}, attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1}, roomId=${roomId}]`,
    );
    this.logger.debug(`Work job data: ${JSON.stringify(job.data)}`);

    this.logger.debug(`Resolving main room for user ${userDid}...`);
    const mainRoomId = await resolveMainRoomId(userDid, this.config);
    this.logger.debug(`Resolved mainRoomId=${mainRoomId}`);

    this.logger.debug(`Reading TaskMeta for task ${taskId}...`);
    const meta = await this.tasksService.getTask({ taskId, mainRoomId });
    this.logger.debug(
      `TaskMeta loaded: status=${meta.status}, jobPattern=${meta.jobPattern}, modelTier=${meta.modelTier}, modelOverride=${meta.modelOverride ?? 'none'}, hasPage=${meta.hasPage}, complexityTier=${meta.complexityTier}`,
    );

    // Guard: skip if not active/dry_run
    if (!isTaskRunnable(meta)) {
      this.logger.log(`Task ${taskId} status is '${meta.status}', skipping`);
      return {
        skipped: true,
        result: '',
        tokensUsed: 0,
        costUsd: 0,
        modelUsed: '',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // Prevent the upload cron from closing the SQLite DB while the agent runs
    this.syncService.markUserActive(userDid);
    try {
      return await this.processWork(
        job,
        taskId,
        userDid,
        roomId,
        mainRoomId,
        meta,
      );
    } finally {
      this.syncService.markUserInactive(userDid);
    }
  }

  private async processWork(
    job: Job<WorkJobData>,
    taskId: string,
    userDid: string,
    roomId: string,
    mainRoomId: string,
    meta: TaskMeta,
  ): Promise<WorkResult> {
    await job.updateProgress(5);

    // Build prompt from task page with execution context
    this.logger.debug(`Building prompt from task page (roomId=${roomId})...`);
    const prompt = await this.buildPromptFromPage(roomId, meta);
    this.logger.debug(
      `Prompt built: length=${prompt.length} chars, preview="${prompt.slice(0, 200)}..."`,
    );

    await job.updateProgress(10);

    // Resolve model from tier/override
    const { modelName, modelRole } = resolveModelForTask(
      meta.modelTier,
      meta.modelOverride,
    );
    this.logger.log(
      `Task ${taskId} model selection: model=${modelName}, role=${modelRole ?? 'override'}, tier=${meta.modelTier}`,
    );

    const startedAt = new Date().toISOString();

    // Build runnable config
    const oracleDid = this.config.getOrThrow<string>('ORACLE_DID');
    const homeServerName = roomId.split(':').slice(1).join(':');

    // Try to retrieve the user's cached openId token for tool auth
    let matrixOpenIdToken: string | undefined;
    try {
      const encrypted = await this.cache.get<string>(
        `${OPENID_CACHE_PREFIX}${userDid}`,
      );
      if (encrypted) {
        const pin = this.config.getOrThrow<string>('MATRIX_VALUE_PIN');
        matrixOpenIdToken = decryptToken(encrypted, pin);
        this.logger.debug(
          `Decrypted cached openId token for task ${taskId} (user ${userDid})`,
        );
      } else {
        this.logger.warn(
          `No cached openId token for user ${userDid} — task ${taskId} will run with degraded tool access (no sandbox, memory auth, or editor)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt cached openId token for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const taskExecutionContext: TaskExecutionContext = {
      taskId,
      taskType: meta.taskType,
      runNumber: meta.totalRuns + 1,
      scheduleCron: meta.scheduleCron,
      timezone: meta.timezone,
      totalCostUsd: meta.totalCostUsd,
      monthlyBudgetUsd: meta.monthlyBudgetUsd,
      consecutiveFailures: meta.consecutiveFailures,
      channelType: meta.channelType,
    };

    const sessionId = crypto.randomUUID();
    const runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
        modelOverride: string;
        taskExecutionContext: TaskExecutionContext;
      };
    } = {
      configurable: {
        thread_id: taskId,
        requestId: `task-work-${taskId}-${Date.now()}`,
        sessionId,
        configs: {
          matrix: {
            roomId: mainRoomId,
            oracleDid,
            homeServerName,
          },
          user: {
            did: userDid,
            ...(matrixOpenIdToken && { matrixOpenIdToken }),
            timezone: meta.timezone,
          },
        },
        modelOverride: modelName,
        taskExecutionContext,
      },
    };

    try {
      // Invoke the agent
      this.logger.debug(
        `Invoking MainAgentGraph.sendMessage for task ${taskId} [sessionId=${taskId}, model=${modelName}]`,
      );
      const agentStartTime = Date.now();
      const result = await this.mainAgent.sendMessage({
        input: prompt,
        runnableConfig,
        browserTools: [],
        msgFromMatrixRoom: true,
        spaceId: meta.spaceId ?? undefined,
        tasksService: this.tasksService,
      });
      const agentDuration = Date.now() - agentStartTime;
      this.logger.debug(
        `Agent invocation completed for task ${taskId} in ${agentDuration}ms, messages returned: ${result.messages.length}`,
      );

      await job.updateProgress(90);

      // Extract result text from last AI message
      const lastMessage = result.messages.at(-1);
      const resultText = lastMessage ? String(lastMessage.content) : '';
      this.logger.debug(
        `Result text extracted: length=${resultText.length} chars, lastMessageType=${lastMessage?.constructor?.name ?? 'none'}`,
      );

      // Extract token usage and cost from message metadata
      let tokensUsed = 0;
      let costUsd = 0;
      let modelUsed = modelName;

      if (lastMessage && lastMessage instanceof AIMessageChunk) {
        const usageMeta = lastMessage.usage_metadata;
        const inputTokens = usageMeta?.input_tokens ?? 0;
        const outputTokens = usageMeta?.output_tokens ?? 0;
        tokensUsed = inputTokens + outputTokens;

        // Extract provider cost and model from response metadata
        let providerCost: number | undefined;
        const responseMeta: unknown = lastMessage.response_metadata;
        if (responseMeta != null && typeof responseMeta === 'object') {
          if (
            'usage' in responseMeta &&
            responseMeta.usage != null &&
            typeof responseMeta.usage === 'object' &&
            'cost' in responseMeta.usage &&
            typeof responseMeta.usage.cost === 'number'
          ) {
            providerCost = responseMeta.usage.cost;
          }
          if (
            'model' in responseMeta &&
            typeof responseMeta.model === 'string'
          ) {
            modelUsed = responseMeta.model;
          }
        }

        // Calculate cost with markup using the same fallback as the token limiter
        costUsd = TokenLimiter.calculateCostUsdWithMarkup({
          providerCost,
          inputTokens,
          outputTokens,
          totalTokens: tokensUsed,
          model: modelUsed || undefined,
        });
      }

      const completedAt = new Date().toISOString();

      this.logger.log(
        `Work job for task ${taskId} completed: tokens=${tokensUsed}, cost=$${costUsd.toFixed(4)}, model=${modelUsed}, duration=${agentDuration}ms`,
      );
      this.logger.debug(
        `Work result details: resultLen=${resultText.length}, startedAt=${startedAt}, completedAt=${completedAt}`,
      );

      // Reset consecutiveFailures on successful work
      await this.tasksService.updateTask({
        taskId,
        mainRoomId,
        updates: { consecutiveFailures: 0, sessionId },
      });

      return {
        skipped: false,
        result: resultText,
        tokensUsed,
        costUsd,
        modelUsed,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Work job for task ${taskId} failed on attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}: ${errorMsg}`,
      );
      if (error instanceof Error && error.stack) {
        this.logger.debug(`Stack trace: ${error.stack}`);
      }

      // Increment consecutiveFailures on every failed attempt (not just the last)
      await handleJobFailure({
        error,
        taskId,
        mainRoomId,
        roomId,
        getTask: () =>
          this.tasksService.getTask(
            { taskId, mainRoomId },
            { bypassCache: true },
          ),
        updateTask: (updates) =>
          this.tasksService.updateTask({ taskId, mainRoomId, updates }),
        logger: this.logger,
      });

      throw error;
    }
  }

  /**
   * Read the task page Y.Doc, extract markdown, and wrap it with
   * execution context so the agent knows it's running autonomously.
   */
  private async buildPromptFromPage(
    docRoomId: string,
    meta: TaskMeta,
  ): Promise<string> {
    return withTaskDoc(docRoomId, async (doc) => {
      const fragment = doc.getXmlFragment('document');
      const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);
      const markdown = await sharedServerEditor.blocksToMarkdownLossy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks as any,
      );

      // Extract human-readable task name from the first heading (e.g. "# Oil Price Monitor")
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      const taskName = titleMatch ? titleMatch[1].trim() : meta.taskId;

      const runNumber = meta.totalRuns + 1;
      const schedule = meta.scheduleCron ?? 'one-shot';
      const lastRun = meta.lastRunAt
        ? formatOutputDate(new Date(meta.lastRunAt), meta.timezone)
        : 'never';
      const budgetStr = meta.monthlyBudgetUsd
        ? `$${meta.totalCostUsd.toFixed(2)} / $${meta.monthlyBudgetUsd.toFixed(2)}`
        : `$${meta.totalCostUsd.toFixed(2)}`;

      // Calculate time budget for the agent
      const timeBudgetMinutes = meta.bufferMinutes;

      // Build previous runs section from recentOutput
      let previousRuns: string;
      if (meta.recentOutput.length > 0) {
        previousRuns = meta.recentOutput
          .map((row) => `- ${row.when}: ${truncateText(row.summary, 200)}`)
          .join('\n');
      } else {
        previousRuns = 'First run — no previous output.';
      }

      const alertRule =
        meta.taskType === 'monitor'
          ? [
              '',
              '### Alert Rule',
              '- If any condition from "What to Do" or "Constraints" is triggered: begin your response with ⚠️ and write the full detailed message the user will receive.',
              '- If nothing triggered: begin your response with ✅ and briefly state what you checked.',
              '- Do NOT use ⚠️ unless a threshold was actually crossed.',
            ]
          : [];

      return [
        `## ${taskName} — Run #${runNumber}`,
        '',
        'You are running autonomously. No human is in the loop — do NOT ask questions or seek clarification.',
        'If the user configured actions that require approval, pause and wait for it; otherwise execute fully.',
        '',
        '### Task Page',
        '---',
        markdown,
        '---',
        '',
        '### Context',
        `- Task: ${taskName} (${meta.taskType})`,
        `- Schedule: ${schedule} | Timezone: ${meta.timezone}`,
        `- Run: #${runNumber} | Last run: ${lastRun}`,
        `- Budget: ${budgetStr}`,
        `- ⏱️ Time budget: ~${timeBudgetMinutes} minutes — you MUST finish within this window. Be fast: use minimal tool calls, don't over-search.`,
        '',
        '### Previous Runs',
        previousRuns,
        '',
        '### Execution Rules',
        '1. **The Task Page is your blueprint — follow it exactly.** It specifies what to do, which agents/tools to use, which URLs to scrape, which skills to load (by name and CID), step-by-step procedures, thresholds, and output format. Do NOT deviate, improvise, or substitute unless a step fails.',
        '2. **Use the agents and tools named in the Task Page.** If the page says "Use Firecrawl Agent to scrape https://oilprice.com", use Firecrawl on that exact URL. If it says "Use the Sandbox with skill X (CID: Y)", load that skill. Do not pick different tools or sources unless the specified ones fail.',
        '3. **Follow the step-by-step procedure** in the "What to Do" section in order. Do not skip steps, reorder them, or add extra steps.',
        '4. Output ONLY the deliverable as described in "How to Report" — match the format, data points, and length exactly.',
        '5. Do not narrate, do not echo instructions, do not add preamble.',
        '6. If a tool or source fails, try any fallback listed in the "Notes" section. If no fallback exists, state the failure factually and continue with available data.',
        '7. Respect all rules in the "Constraints" section — they override your defaults.',
        ...alertRule,
      ].join('\n');
    });
  }
}
