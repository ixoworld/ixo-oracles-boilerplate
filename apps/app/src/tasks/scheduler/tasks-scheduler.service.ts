/**
 * TasksScheduler — BullMQ job creation & cancellation.
 *
 * Manages the lifecycle of BullMQ jobs for both job patterns:
 *   Pattern A (Simple): delayed or repeatable single jobs
 *   Pattern B (Flow):   FlowProducer (one-shot) or repeatable deliver + one-shot work (recurring)
 *
 * @see spec §10 — BullMQ Job Design
 */

import { InjectFlowProducer, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { FlowProducer, Queue } from 'bullmq';

import { QUEUE_NAMES } from './task-queues';
import type {
  DeliverJobData,
  QueueName,
  ScheduleFlowJobParams,
  ScheduleNextWorkJobParams,
  ScheduleRecurringFlowParams,
  ScheduleSimpleJobParams,
  SimpleJobData,
  WorkJobData,
} from './types';

@Injectable()
export class TasksScheduler {
  private readonly logger = new Logger(TasksScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SIMPLE)
    private readonly simpleQueue: Queue<SimpleJobData>,
    @InjectQueue(QUEUE_NAMES.WORK)
    private readonly workQueue: Queue<WorkJobData>,
    @InjectQueue(QUEUE_NAMES.DELIVER)
    private readonly deliverQueue: Queue<DeliverJobData>,
    @InjectFlowProducer('task-flow')
    private readonly flowProducer: FlowProducer,
  ) {}

  // ── Pattern A: Simple Job ────────────────────────────────────────

  /**
   * Schedule a Simple Job (Pattern A).
   * Supports one-shot (delayed) and recurring (repeatable) jobs.
   */
  async scheduleSimpleJob(
    params: ScheduleSimpleJobParams,
  ): Promise<{ jobId: string; repeatKey: string | null }> {
    const jobId = `${params.taskId}:simple`;

    const job = await this.simpleQueue.add(QUEUE_NAMES.SIMPLE, params.data, {
      ...(params.delay != null ? { delay: params.delay } : {}),
      ...(params.repeat ? { repeat: params.repeat } : {}),
      jobId,
    });

    const repeatKey = params.repeat
      ? await this.getRepeatableKey(this.simpleQueue, jobId)
      : null;

    this.logger.log(
      `Scheduled simple job ${jobId} (${params.repeat ? 'recurring' : 'one-shot'})`,
    );

    return { jobId: job.id ?? jobId, repeatKey };
  }

  // ── Pattern B: Flow Job (One-Shot) ───────────────────────────────

  /**
   * Schedule a one-shot Flow Job via FlowProducer.
   * Parent (deliver) waits for child (work) to complete.
   */
  async scheduleFlowJob(
    params: ScheduleFlowJobParams,
  ): Promise<{ deliverJobId: string; workJobId: string }> {
    const deliverJobId = `${params.taskId}:deliver`;
    const workJobId = `${params.taskId}:work`;

    await this.flowProducer.add({
      name: QUEUE_NAMES.DELIVER,
      queueName: QUEUE_NAMES.DELIVER,
      data: params.deliverData,
      opts: { delay: params.deliverDelay, jobId: deliverJobId },
      children: [
        {
          name: QUEUE_NAMES.WORK,
          queueName: QUEUE_NAMES.WORK,
          data: params.workData,
          opts: { delay: params.workDelay, jobId: workJobId },
        },
      ],
    });

    this.logger.log(
      `Scheduled flow job: work=${workJobId}, deliver=${deliverJobId}`,
    );

    return { deliverJobId, workJobId };
  }

  // ── Pattern B: Recurring Flow ────────────────────────────────────

  /**
   * Schedule a recurring Flow Job.
   * Uses a repeatable deliver job + one-shot work jobs.
   * The deliver processor calls `scheduleNextWorkJob()` after each run.
   *
   * @see spec §10.4 — Recurring Flow Job
   */
  async scheduleRecurringFlow(params: ScheduleRecurringFlowParams): Promise<{
    deliverJobId: string;
    repeatKey: string | null;
    workJobId: string | null;
  }> {
    const deliverJobId = `${params.taskId}:deliver`;

    // 1. Repeatable deliver job (fires on cron schedule)
    await this.deliverQueue.add(QUEUE_NAMES.DELIVER, params.deliverData, {
      repeat: params.repeat,
      jobId: deliverJobId,
    });

    const repeatKey = await this.getRepeatableKey(
      this.deliverQueue,
      deliverJobId,
    );

    // 2. Schedule the first work job (if provided)
    let workJobId: string | null = null;
    if (params.firstWork) {
      const result = await this.scheduleNextWorkJob({
        taskId: params.taskId,
        data: params.firstWork.data,
        delay: params.firstWork.delay,
        dateSuffix: new Date(Date.now() + params.firstWork.delay)
          .toISOString()
          .slice(0, 10),
      });
      workJobId = result.jobId;
    }

    this.logger.log(
      `Scheduled recurring flow: deliver=${deliverJobId} (${params.repeat.pattern}), work=${workJobId ?? 'none yet'}`,
    );

    return { deliverJobId, repeatKey, workJobId };
  }

  /**
   * Schedule the next one-shot work job for a recurring flow.
   * Called by the deliver processor after each delivery.
   */
  async scheduleNextWorkJob(
    params: ScheduleNextWorkJobParams,
  ): Promise<{ jobId: string }> {
    const jobId = `${params.taskId}:work:${params.dateSuffix}`;

    await this.workQueue.add(QUEUE_NAMES.WORK, params.data, {
      delay: params.delay,
      jobId,
    });

    this.logger.log(`Scheduled next work job ${jobId}`);
    return { jobId };
  }

  // ── Cancellation ─────────────────────────────────────────────────

  /**
   * Cancel a job by ID from a specific queue.
   * Removes the job if it exists and hasn't completed.
   */
  async cancelJob(queueName: QueueName, jobId: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      this.logger.warn(`Job ${jobId} not found in ${queueName}`);
      return false;
    }

    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      this.logger.warn(`Job ${jobId} already ${state}, skipping cancel`);
      return false;
    }

    await job.remove();
    this.logger.log(`Cancelled job ${jobId} from ${queueName}`);
    return true;
  }

  /**
   * Cancel a repeatable job by its repeat key.
   */
  async cancelRepeatable(
    queueName: QueueName,
    repeatKey: string,
  ): Promise<boolean> {
    const queue = this.getQueue(queueName);

    const removed = await queue.removeRepeatableByKey(repeatKey);
    if (removed) {
      this.logger.log(`Cancelled repeatable ${repeatKey} from ${queueName}`);
    } else {
      this.logger.warn(`Repeatable ${repeatKey} not found in ${queueName}`);
    }
    return removed;
  }

  /**
   * Cancel all jobs for a task (simple, work, and deliver).
   * Best-effort — logs warnings for missing jobs but doesn't throw.
   */
  async cancelAllJobsForTask(
    taskId: string,
    repeatKey?: string | null,
  ): Promise<void> {
    // Cancel simple job
    await this.cancelJob(QUEUE_NAMES.SIMPLE, `${taskId}:simple`).catch(
      () => {},
    );
    // Cancel deliver job
    await this.cancelJob(QUEUE_NAMES.DELIVER, `${taskId}:deliver`).catch(
      () => {},
    );
    // Cancel work job (one-shot flow)
    await this.cancelJob(QUEUE_NAMES.WORK, `${taskId}:work`).catch(() => {});

    // Cancel repeatable if key is known
    if (repeatKey) {
      // Try both queues — we don't always know which one holds it
      await this.cancelRepeatable(QUEUE_NAMES.SIMPLE, repeatKey).catch(
        () => {},
      );
      await this.cancelRepeatable(QUEUE_NAMES.DELIVER, repeatKey).catch(
        () => {},
      );
    }

    this.logger.log(`Cancelled all jobs for task ${taskId}`);
  }

  // ── Queue Access (for processors) ────────────────────────────────

  /** Get a typed reference to a queue by name. Used by processors. */
  getQueue(queueName: string): Queue {
    switch (queueName) {
      case QUEUE_NAMES.SIMPLE:
        return this.simpleQueue;
      case QUEUE_NAMES.WORK:
        return this.workQueue;
      case QUEUE_NAMES.DELIVER:
        return this.deliverQueue;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
  }

  /** Get a typed reference to the work queue. Used by deliver processor for scheduling next work. */
  getWorkQueue(): Queue<WorkJobData> {
    return this.workQueue;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Look up the BullMQ repeat key for a repeatable job.
   * BullMQ assigns this internally — we need it for later cancellation.
   */
  private async getRepeatableKey(
    queue: Queue,
    jobId: string,
  ): Promise<string | null> {
    const repeatables = await queue.getRepeatableJobs();
    const match = repeatables.find((r) => r.id === jobId);
    return match?.key ?? null;
  }
}
