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

import { appendOutputRow } from '../task-doc';
import { withTaskDoc } from '../task-doc-helpers';
import type { TaskMeta } from '../task-meta';
import { QUEUE_NAMES, WORKER_OPTIONS } from '../scheduler/task-queues';
import type { DeliverJobData } from '../scheduler/types';
import { TasksScheduler } from '../scheduler/tasks-scheduler.service';
import { TasksService } from '../task.service';
import {
  DeliverJobDataSchema,
  TASK_RUN_EVENT_TYPE,
  formatOutputDate,
  handleJobFailure,
  isTaskRunnable,
  resolveMainRoomId,
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
  ) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    DeliverJobDataSchema.parse(job.data);

    const { taskId, userId, roomId } = job.data;
    this.logger.log(`Processing deliver job for task ${taskId}`);

    const mainRoomId = await resolveMainRoomId(userId, this.config);
    const meta = await this.tasksService.getTask({ taskId, mainRoomId });

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
    const workResult = await this.getWorkResult(
      job,
      taskId,
      meta.currentWorkJobId,
    );

    try {
      if (!workResult || workResult.skipped) {
        this.logger.log(`No work result for task ${taskId}, skipping delivery`);
      } else {
        // Post formatted result to room (respecting dry_run and notificationPolicy)
        const formattedMessage = this.formatDeliveryMessage(taskId, workResult);
        const messageEventId = await sendTaskNotification({
          roomId,
          userId,
          message: formattedMessage,
          notificationPolicy: meta.notificationPolicy,
          isDryRun: meta.status === 'dry_run',
        });

        // If hasPage: append output row via Y.Doc
        if (meta.hasPage) {
          await this.appendOutputToPage(
            meta,
            mainRoomId,
            workResult,
            messageEventId,
          );
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
        await mxManager.sendMatrixEvent(
          roomId,
          TASK_RUN_EVENT_TYPE,
          runEventContent,
        );

        // Update TaskMeta
        await this.tasksService.updateTask({
          taskId,
          mainRoomId,
          updates: {
            lastRunAt: now.toISOString(),
            totalRuns: meta.totalRuns + 1,
            consecutiveFailures: 0,
            totalTokensUsed: meta.totalTokensUsed + workResult.tokensUsed,
            totalCostUsd: meta.totalCostUsd + workResult.costUsd,
          },
        });
      }

      // Schedule next work job for recurring tasks — recheck status to avoid scheduling for paused tasks
      if (meta.scheduleCron) {
        const freshMeta = await this.tasksService.getTask(
          { taskId, mainRoomId },
          { bypassCache: true },
        );
        if (isTaskRunnable(freshMeta)) {
          await this.scheduleNextWork(freshMeta, mainRoomId);
        }
      }

      this.logger.log(`Deliver job for task ${taskId} completed`);
    } catch (error) {
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
    const childrenValues = await job.getChildrenValues<WorkResult>();
    const childResults = Object.values(childrenValues);
    if (childResults.length > 0) {
      return childResults[0];
    }

    // For recurring flows, look up by the stored work job ID
    if (!currentWorkJobId) {
      return null;
    }

    const workJob = await this.scheduler
      .getWorkQueue()
      .getJob(currentWorkJobId);

    if (!workJob) {
      return null;
    }

    // If work job exists but hasn't completed, throw to retry
    const state = await workJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      throw new Error(
        `Work job ${currentWorkJobId} is still ${state}, retrying deliver`,
      );
    }

    if (state === 'failed') {
      throw new Error(
        `Work job ${currentWorkJobId} failed: ${workJob.failedReason ?? 'unknown reason'}`,
      );
    }

    if (workJob.returnvalue) {
      return workJob.returnvalue as unknown as WorkResult;
    }

    return null;
  }

  /**
   * Format a delivery message from the work result.
   */
  private formatDeliveryMessage(taskId: string, result: WorkResult): string {
    return `📋 **Task ${taskId} — Result**\n\n${result.result}`;
  }

  /**
   * Append an output row to the task page Y.Doc.
   */
  private async appendOutputToPage(
    meta: TaskMeta,
    mainRoomId: string,
    workResult: WorkResult,
    messageEventId?: string,
  ): Promise<void> {
    const docRoomId = meta.customRoomId ?? mainRoomId;

    await withTaskDoc(docRoomId, (doc) => {
      appendOutputRow(doc, {
        when: formatOutputDate(new Date()),
        summary: truncateText(workResult.result, 200),
        link: messageEventId ? `#msg-${messageEventId}` : '',
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
  ): Promise<void> {
    if (!meta.scheduleCron) return;

    const interval = CronExpressionParser.parse(meta.scheduleCron, {
      tz: meta.timezone,
      currentDate: new Date(),
    });
    const nextDelivery = interval.next().toDate();
    const bufferMs = meta.bufferMinutes * 60_000;
    const workDelay = Math.max(
      nextDelivery.getTime() - bufferMs - Date.now(),
      0,
    );
    const roomId = meta.customRoomId ?? mainRoomId;

    const { jobId: nextWorkJobId } = await this.scheduler.scheduleNextWorkJob({
      taskId: meta.taskId,
      data: {
        taskId: meta.taskId,
        userId: meta.userId,
        roomId,
        forDeliveryAt: nextDelivery.toISOString(),
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
