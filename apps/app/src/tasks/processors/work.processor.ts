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
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { AIMessageChunk } from 'langchain';

import { MainAgentGraph } from 'src/graph';
import type { ENV } from 'src/types';
import { normalizeDid } from 'src/utils/header.utils';
import { TokenLimiter } from 'src/utils/token-limit-handler';

import { QUEUE_NAMES, WORKER_OPTIONS } from '../scheduler/task-queues';
import type { WorkJobData } from '../scheduler/types';
import { sharedServerEditor, withTaskDoc } from '../task-doc-helpers';
import { TasksService } from '../task.service';
import {
  WorkJobDataSchema,
  handleJobFailure,
  isTaskRunnable,
  resolveMainRoomId,
  type WorkResult,
} from './processor-utils';

@Processor(QUEUE_NAMES.WORK, WORKER_OPTIONS[QUEUE_NAMES.WORK])
export class WorkProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkProcessor.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly config: ConfigService<ENV>,
    @Inject('MAIN_AGENT_GRAPH') private readonly mainAgent: MainAgentGraph,
  ) {
    super();
  }

  async process(job: Job<WorkJobData>): Promise<WorkResult> {
    WorkJobDataSchema.parse(job.data);

    const { taskId, userId, roomId } = job.data;
    this.logger.log(`Processing work job for task ${taskId}`);

    const mainRoomId = await resolveMainRoomId(userId, this.config);
    const meta = await this.tasksService.getTask({ taskId, mainRoomId });

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

    await job.updateProgress(5);

    // Build prompt from task page or use minimal prompt
    const prompt = await this.buildPromptFromPage(roomId);

    await job.updateProgress(10);

    const startedAt = new Date().toISOString();

    // Build runnable config
    const oracleDid = this.config.getOrThrow<string>('ORACLE_DID');
    const homeServerName = roomId.split(':').slice(1).join(':');
    const sessionId = `task:${taskId}:${Date.now()}`;

    const runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: { sessionId: string };
    } = {
      configurable: {
        thread_id: sessionId,
        requestId: `task-work-${taskId}-${Date.now()}`,
        sessionId,
        configs: {
          matrix: {
            roomId,
            oracleDid,
            homeServerName,
          },
          user: {
            did: normalizeDid(userId),
          },
        },
      },
    };

    try {
      // Invoke the agent
      const result = await this.mainAgent.sendMessage(
        prompt,
        runnableConfig,
        [], // no browser tools
        true, // msgFromMatrixRoom
      );

      await job.updateProgress(90);

      // Extract result text from last AI message
      const lastMessage = result.messages.at(-1);
      const resultText = lastMessage ? String(lastMessage.content) : '';

      // Extract token usage and cost from message metadata
      let tokensUsed = 0;
      let costUsd = 0;
      let modelUsed = '';

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
        `Work job for task ${taskId} completed (${tokensUsed} tokens)`,
      );

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
      // For one-shot flows (FlowProducer), if work exhausts all retries the
      // deliver parent stays in "waiting-children" forever. Handle failure
      // here so the task gets paused and the user is notified.
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
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
      }

      throw error;
    }
  }

  /**
   * Read the task page Y.Doc and extract prompt sections.
   * Looks for "What to Do", "How to Report", and "Constraints" headings.
   */
  private async buildPromptFromPage(docRoomId: string): Promise<string> {
    return withTaskDoc(docRoomId, async (doc) => {
      const fragment = doc.getXmlFragment('document');
      const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);
      const markdown = await sharedServerEditor.blocksToMarkdownLossy(
        blocks as any,
      );

      return `This is Task for U to excute as in the task page\n ${markdown}`;
    });
  }
}
