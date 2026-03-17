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
  ApprovalTimeoutJobData,
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
    @InjectQueue(QUEUE_NAMES.APPROVAL)
    private readonly approvalQueue: Queue<ApprovalTimeoutJobData>,
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
    const jobId = `${params.taskId}-simple`;
    this.logger.debug(
      `scheduleSimpleJob: taskId=${params.taskId}, delay=${params.delay ?? 'none'}, repeat=${params.repeat ? JSON.stringify(params.repeat) : 'none'}`,
    );

    const job = await this.simpleQueue.add(QUEUE_NAMES.SIMPLE, params.data, {
      ...(params.delay != null ? { delay: params.delay } : {}),
      ...(params.repeat ? { repeat: params.repeat } : {}),
      jobId,
    });

    const repeatKey = params.repeat
      ? await this.getRepeatableKey(this.simpleQueue, jobId)
      : null;

    this.logger.log(
      `Scheduled simple job ${jobId} (${params.repeat ? 'recurring' : 'one-shot'}), actualJobId=${job.id}, repeatKey=${repeatKey ?? 'none'}`,
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
    const deliverJobId = `${params.taskId}-deliver`;
    const workJobId = `${params.taskId}-work`;

    this.logger.debug(
      `scheduleFlowJob: taskId=${params.taskId}, workDelay=${params.workDelay}ms, deliverDelay=${params.deliverDelay}ms`,
    );

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
      `Scheduled flow job: work=${workJobId} (delay=${params.workDelay}ms), deliver=${deliverJobId} (delay=${params.deliverDelay}ms)`,
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
    const deliverJobId = `${params.taskId}-deliver`;
    this.logger.debug(
      `scheduleRecurringFlow: taskId=${params.taskId}, cron=${params.repeat.pattern}, tz=${params.repeat.tz ?? 'default'}, firstWorkDelay=${params.firstWork?.delay ?? 'none'}`,
    );

    // 1. Repeatable deliver job (fires on cron schedule)
    await this.deliverQueue.add(QUEUE_NAMES.DELIVER, params.deliverData, {
      repeat: params.repeat,
      jobId: deliverJobId,
    });

    const repeatKey = await this.getRepeatableKey(
      this.deliverQueue,
      deliverJobId,
    );
    this.logger.debug(
      `scheduleRecurringFlow: deliver job added, repeatKey=${repeatKey ?? 'not found'}`,
    );

    // 2. Schedule the first work job (if provided)
    let workJobId: string | null = null;
    if (params.firstWork) {
      const result = await this.scheduleNextWorkJob({
        taskId: params.taskId,
        data: params.firstWork.data,
        delay: params.firstWork.delay,
      });
      workJobId = result.jobId;
    }

    this.logger.log(
      `Scheduled recurring flow: deliver=${deliverJobId} (${params.repeat.pattern}), repeatKey=${repeatKey ?? 'none'}, work=${workJobId ?? 'none yet'}`,
    );

    return { deliverJobId, repeatKey, workJobId };
  }

  /**
   * Schedule the next one-shot work job for a recurring flow.
   * Called by the deliver processor after each delivery.
   * Each job gets a unique UUID-based ID so history is preserved in Redis.
   * The deliver processor finds the right job via `currentWorkJobId` in TaskMeta.
   */
  async scheduleNextWorkJob(
    params: ScheduleNextWorkJobParams,
  ): Promise<{ jobId: string }> {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const jobId = `${params.taskId}-work-${suffix}`;

    this.logger.debug(
      `scheduleNextWorkJob: taskId=${params.taskId}, delay=${params.delay ?? 0}ms, forDeliveryAt=${params.data.forDeliveryAt ?? 'none'}`,
    );

    await this.workQueue.add(QUEUE_NAMES.WORK, params.data, {
      delay: params.delay,
      jobId,
    });

    this.logger.log(
      `Scheduled next work job ${jobId} (delay=${params.delay ?? 0}ms)`,
    );
    return { jobId };
  }

  // ── Cancellation ─────────────────────────────────────────────────

  /**
   * Cancel a job by ID from a specific queue.
   * Removes the job if it exists and hasn't completed.
   */
  async cancelJob(queueName: QueueName, jobId: string): Promise<boolean> {
    this.logger.debug(`cancelJob: looking up job ${jobId} in ${queueName}...`);
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      this.logger.warn(`Job ${jobId} not found in ${queueName}`);
      return false;
    }

    const state = await job.getState();
    this.logger.debug(`cancelJob: job ${jobId} state=${state}`);
    if (state === 'completed' || state === 'failed') {
      this.logger.warn(`Job ${jobId} already ${state}, skipping cancel`);
      return false;
    }

    await job.remove();
    this.logger.log(`Cancelled job ${jobId} from ${queueName} (was ${state})`);
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

    const removed = await queue.removeJobScheduler(repeatKey);
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
    currentWorkJobId?: string | null,
  ): Promise<void> {
    const errors: string[] = [];

    // Cancel simple job
    await this.cancelJob(QUEUE_NAMES.SIMPLE, `${taskId}-simple`).catch((e) =>
      errors.push(`simple: ${e instanceof Error ? e.message : String(e)}`),
    );
    // Cancel deliver job
    await this.cancelJob(QUEUE_NAMES.DELIVER, `${taskId}-deliver`).catch((e) =>
      errors.push(`deliver: ${e instanceof Error ? e.message : String(e)}`),
    );
    // Cancel work job — one-shot uses `{taskId}-work`, recurring uses UUID-based ID
    await this.cancelJob(QUEUE_NAMES.WORK, `${taskId}-work`).catch((e) =>
      errors.push(`work: ${e instanceof Error ? e.message : String(e)}`),
    );
    if (currentWorkJobId && currentWorkJobId !== `${taskId}-work`) {
      await this.cancelJob(QUEUE_NAMES.WORK, currentWorkJobId).catch((e) =>
        errors.push(
          `work-current: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    // Cancel repeatable if key is known
    if (repeatKey) {
      await this.cancelRepeatable(QUEUE_NAMES.SIMPLE, repeatKey).catch((e) =>
        errors.push(
          `simple-repeat: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      await this.cancelRepeatable(QUEUE_NAMES.DELIVER, repeatKey).catch((e) =>
        errors.push(
          `deliver-repeat: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    if (errors.length > 0) {
      this.logger.warn(
        `Some cancellations failed for task ${taskId}: ${errors.join(', ')}`,
      );
    }

    this.logger.log(`Cancelled all jobs for task ${taskId}`);
  }

  // ── Approval Timeout Jobs ───────────────────────────────────────

  /**
   * Schedule reminder (24h) and expiry (48h) timeout jobs for an approval gate.
   * Returns the job IDs so they can be cancelled if the user responds in time.
   */
  async scheduleApprovalTimeouts(params: {
    taskId: string;
    data: ApprovalTimeoutJobData;
    reminderDelayMs: number;
    expiryDelayMs: number;
  }): Promise<{ reminderJobId: string; expiryJobId: string }> {
    const reminderJobId = `${params.taskId}-approval-reminder`;
    const expiryJobId = `${params.taskId}-approval-expiry`;

    await this.approvalQueue.add(
      QUEUE_NAMES.APPROVAL,
      { ...params.data, phase: 'reminder' },
      { delay: params.reminderDelayMs, jobId: reminderJobId },
    );

    await this.approvalQueue.add(
      QUEUE_NAMES.APPROVAL,
      { ...params.data, phase: 'expiry' },
      { delay: params.expiryDelayMs, jobId: expiryJobId },
    );

    this.logger.log(
      `Scheduled approval timeouts for task ${params.taskId}: reminder=${reminderJobId} (${params.reminderDelayMs}ms), expiry=${expiryJobId} (${params.expiryDelayMs}ms)`,
    );

    return { reminderJobId, expiryJobId };
  }

  /**
   * Cancel pending approval timeout jobs for a task.
   * Called when the user responds to an approval request.
   */
  async cancelApprovalTimeouts(taskId: string): Promise<void> {
    await this.cancelJob(
      QUEUE_NAMES.APPROVAL,
      `${taskId}-approval-reminder`,
    ).catch(() => {});
    await this.cancelJob(
      QUEUE_NAMES.APPROVAL,
      `${taskId}-approval-expiry`,
    ).catch(() => {});
    this.logger.log(`Cancelled approval timeouts for task ${taskId}`);
  }

  /** Get a typed reference to the approval queue. */
  getApprovalQueue(): Queue<ApprovalTimeoutJobData> {
    return this.approvalQueue;
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
      case QUEUE_NAMES.APPROVAL:
        return this.approvalQueue;
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
    const schedulers = await queue.getJobSchedulers();
    const match = schedulers.find((r) => r.id === jobId);
    return match?.key ?? null;
  }
}
