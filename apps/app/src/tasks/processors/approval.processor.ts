/**
 * ApprovalProcessor — Handles approval timeout and reminder jobs.
 *
 * Two phases:
 *   - 'reminder' (24h): Sends a reminder that the result is still pending review.
 *   - 'expiry' (48h):   Auto-discards the result and notifies the user.
 *
 * @see spec §14 — Approval Gates
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ApprovalService } from '../approval.service';
import { QUEUE_NAMES, WORKER_OPTIONS } from '../scheduler/task-queues';
import type { ApprovalTimeoutJobData } from '../scheduler/types';

@Processor(QUEUE_NAMES.APPROVAL, WORKER_OPTIONS[QUEUE_NAMES.APPROVAL])
export class ApprovalProcessor extends WorkerHost {
  private readonly logger = new Logger(ApprovalProcessor.name);

  constructor(private readonly approvalService: ApprovalService) {
    super();
  }

  async process(job: Job<ApprovalTimeoutJobData>): Promise<void> {
    const { taskId, roomId, mainRoomId, matrixUserId, phase } = job.data;
    this.logger.log(
      `Processing approval ${phase} for task ${taskId} [jobId=${job.id}]`,
    );

    await this.approvalService.handleApprovalTimeout({
      taskId,
      mainRoomId,
      roomId,
      matrixUserId,
      phase,
    });

    this.logger.log(`Approval ${phase} processed for task ${taskId}`);
  }
}
