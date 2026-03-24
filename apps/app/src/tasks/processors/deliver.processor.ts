/**
 * DeliverProcessor — Pattern B deliver parent processor.
 *
 * Retrieves the work result from the child job, posts the formatted
 * result to the room, updates TaskMeta, and (for recurring tasks)
 * schedules the next work job.
 *
 * @see spec §10.3 — Flow Job (Deliver Parent)
 */

import { MatrixManager } from '@ixo/matrix';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { CronExpressionParser } from 'cron-parser';

import type { ENV } from 'src/types';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';

import { SessionManagerService } from '@ixo/common';
import { ApprovalService } from '../approval.service';
import { QUEUE_NAMES, WORKER_OPTIONS } from '../scheduler/task-queues';
import { TasksScheduler } from '../scheduler/tasks-scheduler.service';
import type { DeliverJobData } from '../scheduler/types';
import { appendOutputRow, readTaskMeta } from '../task-doc';
import { sharedServerEditor, withTaskDoc } from '../task-doc-helpers';
import type { TaskMeta } from '../task-meta';
import { formatOutputSection } from '../task-page-template';
import { TasksService } from '../task.service';
import {
  DeliverJobDataSchema,
  TASK_RUN_EVENT_TYPE,
  formatOutputDate,
  handleJobFailure,
  isTaskRunnable,
  resolveMainRoomId,
  resolveWorkDelay,
  sanitizeSummary,
  sendTaskNotification,
  truncateText,
  type TaskRunEventContent,
  type WorkResult,
} from './processor-utils';

@Processor(QUEUE_NAMES.DELIVER, WORKER_OPTIONS[QUEUE_NAMES.DELIVER])
export class DeliverProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliverProcessor.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly scheduler: TasksScheduler,
    private readonly config: ConfigService<ENV>,
    private readonly sessionManagerService: SessionManagerService,
    private readonly syncService: UserMatrixSqliteSyncService,
    private readonly approvalService: ApprovalService,
  ) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    DeliverJobDataSchema.parse(job.data);

    const { taskId, userDid, matrixUserId, roomId } = job.data;
    this.logger.log(
      `Processing deliver job for task ${taskId} [jobId=${job.id}, attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1}, roomId=${roomId}]`,
    );
    this.logger.debug(`Deliver job data: ${JSON.stringify(job.data)}`);

    // Prevent the upload cron from closing the SQLite DB while the job runs
    this.syncService.markUserActive(userDid);

    this.logger.debug(`Resolving main room for user ${userDid}...`);
    const mainRoomId = await resolveMainRoomId(userDid, this.config);
    this.logger.debug(`Resolved mainRoomId=${mainRoomId}`);

    this.logger.debug(`Reading TaskMeta for task ${taskId}...`);
    const meta = await this.tasksService.getTask({ taskId, mainRoomId });
    this.logger.debug(
      `TaskMeta loaded: status=${meta.status}, totalRuns=${meta.totalRuns}, scheduleCron=${meta.scheduleCron ?? 'none'}, currentWorkJobId=${meta.currentWorkJobId ?? 'none'}, hasPage=${meta.hasPage}`,
    );

    // Guard: skip if not active/dry_run
    if (!isTaskRunnable(meta)) {
      this.logger.log(
        `Task ${taskId} status is '${meta.status}', skipping delivery`,
      );
      return;
    }

    const mxManager = MatrixManager.getInstance();
    const now = new Date();

    // Get work result from child job
    this.logger.debug(
      `Retrieving work result for task ${taskId} (currentWorkJobId=${meta.currentWorkJobId ?? 'none'})...`,
    );
    const workResult = await this.getWorkResult(
      job,
      taskId,
      meta.currentWorkJobId,
    );
    this.logger.debug(
      `Work result: ${workResult ? `skipped=${workResult.skipped}, resultLen=${workResult.result.length}, tokens=${workResult.tokensUsed}, cost=$${workResult.costUsd.toFixed(4)}` : 'null'}`,
    );

    try {
      if (!workResult || workResult.skipped) {
        this.logger.log(`No work result for task ${taskId}, skipping delivery`);
      } else if (meta.requiresApproval && meta.status !== 'dry_run') {
        // ── Approval Gate ─────────────────────────────────────────
        // Instead of delivering immediately, request user approval.
        // The ApprovalService stores the result in Redis and posts
        // an approval request message. Delivery happens when the
        // user responds (via Portal or Matrix).
        this.logger.log(
          `Task ${taskId} requires approval — requesting user confirmation`,
        );
        await this.approvalService.requestApproval({
          taskId,
          userDid,
          matrixUserId,
          roomId,
          mainRoomId,
          workResult,
          meta,
        });
        // Still schedule next work for recurring tasks
      } else {
        // Post formatted result to room (respecting dry_run and notificationPolicy)
        // Guard: skip if already sent on a previous attempt (idempotent retry)
        const progress = (job.progress as Record<string, unknown>) || {};
        let messageEventId: string | undefined;
        if (progress.notificationSent) {
          messageEventId = progress.notificationEventId as string | undefined;
          this.logger.debug(
            `Delivery notification already sent on previous attempt, skipping (eventId=${messageEventId ?? 'none'})`,
          );
        } else {
          const conditionMet = workResult.result.includes('⚠️');
          const shouldNotify =
            meta.notificationPolicy !== 'on_threshold' || conditionMet;

          if (!shouldNotify) {
            this.logger.log(
              `Monitor condition not met for task ${taskId}, skipping notification`,
            );
          } else {
            const formattedMessage = this.formatDeliveryMessage(
              workResult,
              job.data.title,
            );
            this.logger.debug(
              `Sending delivery notification: policy=${meta.notificationPolicy}, isDryRun=${meta.status === 'dry_run'}, messageLen=${formattedMessage.length}`,
            );
            messageEventId = await sendTaskNotification({
              roomId,
              matrixUserId,
              message: formattedMessage,
              notificationPolicy: meta.notificationPolicy,
              isDryRun: meta.status === 'dry_run',
              sessionId: meta.sessionId,
              sessionManagerService: this.sessionManagerService,
              configService: this.config,
            });
          }
          await job.updateProgress({
            ...progress,
            notificationSent: true,
            notificationEventId: messageEventId,
          });
          this.logger.debug(
            `Delivery notification sent: eventId=${messageEventId ?? 'none (dry_run/silent)'}`,
          );
        }

        // If hasPage: append output row via Y.Doc
        if (meta.hasPage) {
          this.logger.debug(`Appending output to task page Y.Doc...`);
          await this.appendOutputToPage(
            meta,
            mainRoomId,
            workResult,
            messageEventId,
          );
          this.logger.debug(`Output appended to task page`);
        }

        // Post task run event
        const runEventContent: TaskRunEventContent = {
          taskId,
          runAt: now.toISOString(),
          status: 'success',
          totalRuns: meta.totalRuns + 1,
          summary: truncateText(workResult.result, 100),
          tokensUsed: workResult.tokensUsed,
          costUsd: workResult.costUsd,
        };
        this.logger.debug(
          `Posting run event: ${JSON.stringify(runEventContent)}`,
        );
        await mxManager.sendMatrixEvent(
          roomId,
          TASK_RUN_EVENT_TYPE,
          runEventContent,
        );
        this.logger.debug(`Run event posted to room ${roomId}`);

        // Update TaskMeta
        const updates = {
          lastRunAt: now.toISOString(),
          totalRuns: meta.totalRuns + 1,
          consecutiveFailures: 0,
          totalTokensUsed: meta.totalTokensUsed + workResult.tokensUsed,
          totalCostUsd: meta.totalCostUsd + workResult.costUsd,
        };
        this.logger.debug(`Updating TaskMeta: ${JSON.stringify(updates)}`);
        await this.tasksService.updateTask({
          taskId,
          mainRoomId,
          updates,
        });
        this.logger.debug(`TaskMeta updated for task ${taskId}`);
      }

      // Schedule next work job for recurring tasks — recheck status to avoid scheduling for paused tasks
      if (meta.scheduleCron) {
        this.logger.debug(
          `Task ${taskId} is recurring (cron=${meta.scheduleCron}), checking if next work should be scheduled...`,
        );
        const freshMeta = await this.tasksService.getTask(
          { taskId, mainRoomId },
          { bypassCache: true },
        );
        this.logger.debug(
          `Fresh status for task ${taskId}: ${freshMeta.status}`,
        );
        if (isTaskRunnable(freshMeta)) {
          await this.scheduleNextWork(freshMeta, mainRoomId, job.data.title);
        } else {
          this.logger.log(
            `Task ${taskId} no longer runnable (status=${freshMeta.status}), skipping next work schedule`,
          );
        }
      } else if (meta.status !== 'dry_run') {
        // One-shot flow task — mark as completed
        this.logger.log(
          `Task ${taskId} is one-shot (no cron), marking as completed`,
        );
        await this.tasksService.updateTask({
          taskId,
          mainRoomId,
          updates: { status: 'completed' },
        });
      } else {
        // Dry run one-shot — revert to active so the real run can happen
        this.logger.log(`Task ${taskId} dry run finished, reverting to active`);
        await this.tasksService.updateTask({
          taskId,
          mainRoomId,
          updates: { status: 'active' },
        });
      }

      this.logger.log(
        `Deliver job for task ${taskId} completed (run #${meta.totalRuns + 1})`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Deliver job for task ${taskId} failed on attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}: ${errorMsg}`,
      );
      if (error instanceof Error && error.stack) {
        this.logger.debug(`Stack trace: ${error.stack}`);
      }
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
    } finally {
      this.syncService.markUserInactive(userDid);
    }
  }

  /**
   * Retrieve the work result from the work job.
   *
   * One-shot flows: uses getChildrenValues() (FlowProducer link).
   * Recurring flows: reads `currentWorkJobId` from TaskMeta to find the job.
   *
   * Throws if the work job exists but hasn't completed yet,
   * so BullMQ retries the deliver job with backoff.
   */
  private async getWorkResult(
    job: Job<DeliverJobData>,
    taskId: string,
    currentWorkJobId: string | null,
  ): Promise<WorkResult | null> {
    // For one-shot flows, try getChildrenValues first (FlowProducer link)
    this.logger.debug(`Checking children values for deliver job ${job.id}...`);
    const childrenValues = await job.getChildrenValues<WorkResult>();
    const childResults = Object.values(childrenValues);
    this.logger.debug(
      `Children values: ${childResults.length} result(s) found`,
    );
    if (childResults.length > 0) {
      this.logger.debug(`Using child result from FlowProducer link`);
      return childResults[0];
    }

    // For recurring flows, look up by the stored work job ID
    if (!currentWorkJobId) {
      this.logger.debug(`No currentWorkJobId set, returning null`);
      return null;
    }

    this.logger.debug(
      `Looking up work job ${currentWorkJobId} in work queue...`,
    );
    const workJob = await this.scheduler
      .getWorkQueue()
      .getJob(currentWorkJobId);

    if (!workJob) {
      this.logger.warn(`Work job ${currentWorkJobId} not found in queue`);
      return null;
    }

    // If work job exists but hasn't completed, throw to retry
    const state = await workJob.getState();
    this.logger.debug(`Work job ${currentWorkJobId} state: ${state}`);
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      throw new Error(
        `Work job ${currentWorkJobId} is still ${state}, retrying deliver`,
      );
    }

    if (state === 'failed') {
      this.logger.error(
        `Work job ${currentWorkJobId} failed: ${workJob.failedReason ?? 'unknown reason'}`,
      );
      throw new Error(
        `Work job ${currentWorkJobId} failed: ${workJob.failedReason ?? 'unknown reason'}`,
      );
    }

    if (workJob.returnvalue) {
      this.logger.debug(
        `Work job ${currentWorkJobId} has return value, using it`,
      );
      return workJob.returnvalue as unknown as WorkResult;
    }

    this.logger.debug(
      `Work job ${currentWorkJobId} completed but no return value`,
    );
    return null;
  }

  /**
   * Format a delivery message from the work result.
   */
  private formatDeliveryMessage(result: WorkResult, title?: string): string {
    const header = title ? `📋 **${title}**` : '📋 **Task Result**';
    return `${header}\n\n${result.result}`;
  }

  /**
   * Append an output row to the task page Y.Doc and regenerate the
   * "Recent Output" table in the BlockNote document content.
   */
  private async appendOutputToPage(
    meta: TaskMeta,
    mainRoomId: string,
    workResult: WorkResult,
    messageEventId?: string,
  ): Promise<void> {
    const docRoomId = meta.customRoomId ?? mainRoomId;

    await withTaskDoc(docRoomId, async (doc) => {
      // 1. Append the new row to the Y.Map sidecar
      appendOutputRow(doc, {
        when: formatOutputDate(new Date(), meta.timezone),
        summary: truncateText(sanitizeSummary(workResult.result), 200),
        link: messageEventId ? `#msg-${messageEventId}` : '',
      });

      // 2. Regenerate the "Recent Output" table in the document
      const updatedMeta = readTaskMeta(doc);
      const tableMd = formatOutputSection(updatedMeta);
      const tableBlocks =
        await sharedServerEditor.tryParseMarkdownToBlocks(tableMd);

      const fragment = doc.getXmlFragment('document');
      const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);

      // Find the "Recent Output" heading
      const headingIdx = blocks.findIndex(
        (b) =>
          b.type === 'heading' &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((b.content as any)?.[0]?.text as string | undefined)
            ?.trim()
            .toLowerCase() === 'recent output',
      );

      if (headingIdx === -1) {
        this.logger.warn(
          `"Recent Output" heading not found in task page, skipping table update`,
        );
        return;
      }

      // Find the range after the heading until the next heading or end of doc
      const afterHeading = headingIdx + 1;
      let endIdx = blocks.length;
      for (let i = afterHeading; i < blocks.length; i++) {
        if (blocks[i].type === 'heading') {
          endIdx = i;
          break;
        }
      }

      // Rebuild: everything before table section + heading + new table blocks + rest
      const rebuilt = [
        ...blocks.slice(0, afterHeading),
        ...tableBlocks,
        ...blocks.slice(endIdx),
      ];

      // Replace document content
      doc.transact(() => {
        while (fragment.length > 0) {
          fragment.delete(0, 1);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sharedServerEditor.blocksToYXmlFragment(rebuilt as any, fragment);
      });
    });
  }

  /**
   * Schedule the next work job for a recurring flow task.
   * Computes the next delivery time from cron, subtracts buffer, and schedules.
   */
  private async scheduleNextWork(
    meta: TaskMeta,
    mainRoomId: string,
    title?: string,
  ): Promise<void> {
    if (!meta.scheduleCron) return;

    const interval = CronExpressionParser.parse(meta.scheduleCron, {
      tz: meta.timezone,
      currentDate: new Date(),
    });
    const nextDelivery = interval.next().toDate();
    const bufferMs = meta.bufferMinutes * 60_000;
    const workDelay = resolveWorkDelay(
      nextDelivery.getTime(),
      bufferMs,
      this.logger,
      meta.taskId,
    );
    const roomId = meta.customRoomId ?? mainRoomId;

    const { jobId: nextWorkJobId } = await this.scheduler.scheduleNextWorkJob({
      taskId: meta.taskId,
      data: {
        taskId: meta.taskId,
        userDid: meta.userDid,
        roomId,
        forDeliveryAt: nextDelivery.toISOString(),
        title,
        taskType: meta.taskType,
        scheduleCron: meta.scheduleCron ?? undefined,
      },
      delay: workDelay,
    });

    // Store the new work job ID in TaskMeta so next deliver can find it
    await this.tasksService.updateTask({
      taskId: meta.taskId,
      mainRoomId,
      updates: { currentWorkJobId: nextWorkJobId },
    });

    this.logger.log(
      `Scheduled next work job for task ${meta.taskId} at ${nextDelivery.toISOString()} (delay: ${workDelay}ms)`,
    );
  }
}
