/**
 * ApprovalService — Core logic for task approval gates.
 *
 * Handles storing pending work results in Redis, processing user
 * approval/rejection responses, and delivering or discarding results.
 *
 * Shared between Portal API and Matrix message paths.
 *
 * @see spec §14 — Approval Gates
 */

import { SessionManagerService } from '@ixo/common';
import { MatrixManager } from '@ixo/matrix';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import type { ENV } from 'src/types';

import { QUEUE_NAMES } from './scheduler/task-queues';
import { TasksScheduler } from './scheduler/tasks-scheduler.service';
import type { ApprovalTimeoutJobData } from './scheduler/types';
import { appendOutputRow, readTaskMeta } from './task-doc';
import { sharedServerEditor, withTaskDoc } from './task-doc-helpers';
import type { TaskMeta } from './task-meta';
import { formatOutputSection } from './task-page-template';
import { TasksService } from './task.service';
import {
  APPROVAL_EXPIRY_MS,
  APPROVAL_REMINDER_MS,
  APPROVAL_REQUEST_EVENT_TYPE,
  APPROVAL_RESULT_PREFIX,
  APPROVAL_RESULT_TTL_SECONDS,
  TASK_RUN_EVENT_TYPE,
  formatApprovalRequestMessage,
  formatOutputDate,
  sanitizeSummary,
  sendTaskNotification,
  truncateText,
  type ApprovalRequestEventContent,
  type TaskRunEventContent,
  type WorkResult,
} from './processors/processor-utils';

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly scheduler: TasksScheduler,
    private readonly config: ConfigService<ENV>,
    private readonly sessionManagerService: SessionManagerService,
    @InjectQueue(QUEUE_NAMES.APPROVAL)
    private readonly approvalQueue: Queue<ApprovalTimeoutJobData>,
  ) {}

  /**
   * Store a work result in Redis and post an approval request message.
   * Called by the DeliverProcessor when `requiresApproval` is true.
   *
   * @returns The event ID of the approval request message
   */
  async requestApproval(params: {
    taskId: string;
    userDid: string;
    matrixUserId: string;
    roomId: string;
    mainRoomId: string;
    workResult: WorkResult;
    meta: TaskMeta;
  }): Promise<string | undefined> {
    const { taskId, userDid, matrixUserId, roomId, mainRoomId, workResult } =
      params;

    // 1. Store work result in Redis via the approval queue's connection
    const redisKey = `${APPROVAL_RESULT_PREFIX}${taskId}`;
    const connection = this.approvalQueue.opts?.connection;
    if (!connection) {
      throw new Error('No Redis connection available from approval queue');
    }

    // Use the queue client to set the value
    const client = await this.approvalQueue.client;
    await client.set(
      redisKey,
      JSON.stringify(workResult),
      'EX',
      APPROVAL_RESULT_TTL_SECONDS,
    );
    this.logger.debug(
      `Stored work result in Redis: key=${redisKey}, TTL=${APPROVAL_RESULT_TTL_SECONDS}s`,
    );

    // 2. Post approval request message to room (with structured metadata for FE)
    const message = formatApprovalRequestMessage(taskId, workResult.result);
    const mxManager = MatrixManager.getInstance();
    const approvalEventId = await sendTaskNotification({
      roomId,
      matrixUserId,
      message,
      notificationPolicy: 'channel_and_mention',
      isDryRun: false,
      sessionId: params.meta.sessionId,
      sessionManagerService: this.sessionManagerService,
      configService: this.config,
    });

    // 3. Post a custom approval event for tracking
    const approvalContent: ApprovalRequestEventContent = {
      taskId,
      status: 'pending',
      preview: truncateText(workResult.result, 500),
      requestedAt: new Date().toISOString(),
    };
    await mxManager.sendMatrixEvent(
      roomId,
      APPROVAL_REQUEST_EVENT_TYPE,
      approvalContent,
    );

    // 4. Update TaskMeta with pending approval
    await this.tasksService.updateTask({
      taskId,
      mainRoomId,
      updates: { pendingApprovalEventId: approvalEventId ?? null },
    });

    // 5. Schedule timeout jobs (reminder at 24h, expiry at 48h)
    await this.scheduler.scheduleApprovalTimeouts({
      taskId,
      data: {
        taskId,
        userDid,
        matrixUserId,
        roomId,
        mainRoomId,
        phase: 'reminder',
      },
      reminderDelayMs: APPROVAL_REMINDER_MS,
      expiryDelayMs: APPROVAL_EXPIRY_MS,
    });

    this.logger.log(
      `Approval requested for task ${taskId}, eventId=${approvalEventId}`,
    );
    return approvalEventId;
  }

  /**
   * Handle a user's approval or rejection response.
   * Called when the user replies to an approval request (from Portal or Matrix).
   */
  async handleApprovalResponse(params: {
    taskId: string;
    approved: boolean;
    mainRoomId: string;
  }): Promise<void> {
    const { taskId, approved, mainRoomId } = params;
    this.logger.log(
      `Processing approval response for task ${taskId}: ${approved ? 'APPROVED' : 'REJECTED'}`,
    );

    const client = await this.approvalQueue.client;

    // Atomicity guard: use Redis SETNX to prevent concurrent handling.
    // Only one caller can acquire the lock — duplicates are silently dropped.
    const lockKey = `task:approval-lock:${taskId}`;
    const acquired = await client.set(lockKey, '1', 'EX', 60, 'NX');
    if (!acquired) {
      this.logger.warn(
        `Task ${taskId} approval response already being processed, ignoring duplicate`,
      );
      return;
    }

    try {
      // 1. Load TaskMeta (bypass cache to get fresh state)
      const meta = await this.tasksService.getTask(
        { taskId, mainRoomId },
        { bypassCache: true },
      );

      if (!meta.pendingApprovalEventId) {
        this.logger.warn(
          `Task ${taskId} has no pending approval, ignoring response`,
        );
        return;
      }

      // 2. Load cached work result from Redis
      const redisKey = `${APPROVAL_RESULT_PREFIX}${taskId}`;
      const rawResult = await client.get(redisKey);

      if (!rawResult) {
        this.logger.warn(
          `No cached work result found for task ${taskId}, may have expired`,
        );
        const mxManager = MatrixManager.getInstance();
        const roomId = meta.customRoomId ?? mainRoomId;
        await mxManager.sendMessage({
          roomId,
          message:
            'The task result has expired and is no longer available. The next scheduled run will produce a new result for review.',
          isOracleAdmin: true,
        });
        await this.clearApprovalState(taskId, mainRoomId);
        return;
      }

      const workResult: WorkResult = JSON.parse(rawResult);
      const roomId = meta.customRoomId ?? mainRoomId;
      const now = new Date();

      if (approved) {
        await this.deliverApprovedResult({
          taskId,
          meta,
          workResult,
          roomId,
          mainRoomId,
          now,
        });
      } else {
        await this.handleRejection({ taskId, roomId, mainRoomId, meta });
      }

      // Clean up approval state (clears Redis result, TaskMeta, and timeout jobs)
      await this.clearApprovalState(taskId, mainRoomId);
    } finally {
      // Release the atomicity lock
      await client.del(lockKey).catch(() => {});
    }
  }

  /**
   * Deliver an approved work result — mirrors DeliverProcessor's delivery logic.
   */
  private async deliverApprovedResult(params: {
    taskId: string;
    meta: TaskMeta;
    workResult: WorkResult;
    roomId: string;
    mainRoomId: string;
    now: Date;
  }): Promise<void> {
    const { taskId, meta, workResult, roomId, mainRoomId, now } = params;
    const mxManager = MatrixManager.getInstance();

    // Send the actual result to the room
    const formattedMessage = `**Task ${taskId} — Result (Approved)**\n\n${workResult.result}`;
    const messageEventId = await sendTaskNotification({
      roomId,
      matrixUserId: meta.matrixUserId,
      message: formattedMessage,
      notificationPolicy: meta.notificationPolicy,
      isDryRun: false,
      sessionId: meta.sessionId,
      sessionManagerService: this.sessionManagerService,
      configService: this.config,
    });

    // Append output to task page if it exists
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

    this.logger.log(`Delivered approved result for task ${taskId}`);
  }

  /**
   * Handle a rejected approval — log and notify.
   */
  private async handleRejection(params: {
    taskId: string;
    roomId: string;
    mainRoomId: string;
    meta: TaskMeta;
  }): Promise<void> {
    const { taskId, roomId } = params;
    const mxManager = MatrixManager.getInstance();

    await mxManager.sendMessage({
      roomId,
      message: `Result for task discarded. The next scheduled run will produce a new result.`,
      isOracleAdmin: true,
    });

    // Post approval event update
    const approvalContent: ApprovalRequestEventContent = {
      taskId,
      status: 'rejected',
      preview: '',
      requestedAt: '',
      resolvedAt: new Date().toISOString(),
    };
    await mxManager.sendMatrixEvent(
      roomId,
      APPROVAL_REQUEST_EVENT_TYPE,
      approvalContent,
    );

    this.logger.log(`Result rejected for task ${taskId}`);
  }

  /**
   * Handle approval timeout — send reminder or auto-discard.
   * Called by the ApprovalProcessor.
   */
  async handleApprovalTimeout(params: {
    taskId: string;
    mainRoomId: string;
    roomId: string;
    matrixUserId: string;
    phase: 'reminder' | 'expiry';
  }): Promise<void> {
    const { taskId, mainRoomId, roomId, phase } = params;
    const meta = await this.tasksService.getTask(
      { taskId, mainRoomId },
      { bypassCache: true },
    );

    if (!meta.pendingApprovalEventId) {
      this.logger.debug(
        `Task ${taskId} no longer has pending approval (${phase}), skipping`,
      );
      return;
    }

    const mxManager = MatrixManager.getInstance();

    if (phase === 'reminder') {
      await mxManager.sendMessage({
        roomId,
        message:
          'Reminder: A task result is still waiting for your review. Reply with **yes** to deliver, or **no** to discard.',
        isOracleAdmin: true,
      });
      this.logger.log(`Sent approval reminder for task ${taskId}`);
    } else {
      // Expiry — auto-discard
      const client = await this.approvalQueue.client;
      const redisKey = `${APPROVAL_RESULT_PREFIX}${taskId}`;
      await client.del(redisKey);

      await mxManager.sendMessage({
        roomId,
        message:
          'The pending task result has expired after 48 hours without a response and has been discarded. The next scheduled run will produce a new result.',
        isOracleAdmin: true,
      });

      const approvalContent: ApprovalRequestEventContent = {
        taskId,
        status: 'expired',
        preview: '',
        requestedAt: '',
        resolvedAt: new Date().toISOString(),
      };
      await mxManager.sendMatrixEvent(
        roomId,
        APPROVAL_REQUEST_EVENT_TYPE,
        approvalContent,
      );

      await this.clearApprovalState(taskId, mainRoomId);
      this.logger.log(`Approval expired for task ${taskId}, result discarded`);
    }
  }

  /**
   * Clear the approval state from TaskMeta and cancel timeout jobs.
   * Also removes cached work result from Redis.
   *
   * Called when:
   * - User approves/rejects a result
   * - Approval times out
   * - Task is cancelled/paused while approval is pending
   */
  async clearApprovalState(taskId: string, mainRoomId: string): Promise<void> {
    // Remove cached work result from Redis
    const client = await this.approvalQueue.client;
    const redisKey = `${APPROVAL_RESULT_PREFIX}${taskId}`;
    await client.del(redisKey).catch(() => {});

    await this.tasksService.updateTask({
      taskId,
      mainRoomId,
      updates: { pendingApprovalEventId: null },
    });
    await this.scheduler.cancelApprovalTimeouts(taskId);
  }

  /**
   * Append output row to task page Y.Doc (mirrors deliver.processor logic).
   */
  private async appendOutputToPage(
    meta: TaskMeta,
    mainRoomId: string,
    workResult: WorkResult,
    messageEventId?: string,
  ): Promise<void> {
    const docRoomId = meta.customRoomId ?? mainRoomId;

    await withTaskDoc(docRoomId, async (doc) => {
      appendOutputRow(doc, {
        when: formatOutputDate(new Date(), meta.timezone),
        summary: truncateText(sanitizeSummary(workResult.result), 200),
        link: messageEventId ? `#msg-${messageEventId}` : '',
      });

      const updatedMeta = readTaskMeta(doc);
      const tableMd = formatOutputSection(updatedMeta);
      const tableBlocks =
        await sharedServerEditor.tryParseMarkdownToBlocks(tableMd);

      const fragment = doc.getXmlFragment('document');
      const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);

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

      const afterHeading = headingIdx + 1;
      let endIdx = blocks.length;
      for (let i = afterHeading; i < blocks.length; i++) {
        if (blocks[i].type === 'heading') {
          endIdx = i;
          break;
        }
      }

      const rebuilt = [
        ...blocks.slice(0, afterHeading),
        ...tableBlocks,
        ...blocks.slice(endIdx),
      ];

      doc.transact(() => {
        while (fragment.length > 0) {
          fragment.delete(0, 1);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sharedServerEditor.blocksToYXmlFragment(rebuilt as any, fragment);
      });
    });
  }
}
