/**
 * SimpleProcessor — Pattern A job processor.
 *
 * Handles reminders and lightweight message sends.
 * Reads task metadata, sends a message to the room (respecting
 * notificationPolicy), posts a run event, and updates TaskMeta.
 *
 * @see spec §10.2 — Simple Job
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatrixManager } from '@ixo/matrix';
import type { Job } from 'bullmq';

import type { ENV } from 'src/types';

import { QUEUE_NAMES } from '../scheduler/task-queues';
import { WORKER_OPTIONS } from '../scheduler/task-queues';
import type { SimpleJobData } from '../scheduler/types';
import { TasksService } from '../task.service';
import {
  SimpleJobDataSchema,
  TASK_RUN_EVENT_TYPE,
  handleJobFailure,
  isTaskRunnable,
  resolveMainRoomId,
  sendTaskNotification,
  type TaskRunEventContent,
} from './processor-utils';

@Processor(QUEUE_NAMES.SIMPLE, WORKER_OPTIONS[QUEUE_NAMES.SIMPLE])
export class SimpleProcessor extends WorkerHost {
  private readonly logger = new Logger(SimpleProcessor.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly config: ConfigService<ENV>,
  ) {
    super();
  }

  async process(job: Job<SimpleJobData>): Promise<void> {
    SimpleJobDataSchema.parse(job.data);
    const { taskId, userDid, matrixUserId, roomId, message } = job.data;
    this.logger.log(
      `Processing simple job for task ${taskId} [jobId=${job.id}, attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1}, roomId=${roomId}]`,
    );
    this.logger.debug(
      `Simple job data: ${JSON.stringify({ taskId, userDid, matrixUserId, roomId, messageLen: message.length })}`,
    );

    this.logger.debug(`Resolving main room for user ${userDid}...`);
    const mainRoomId = await resolveMainRoomId(userDid, this.config);
    this.logger.debug(`Resolved mainRoomId=${mainRoomId}`);

    try {
      // 1. Read TaskMeta
      this.logger.debug(`Reading TaskMeta for task ${taskId}...`);
      const meta = await this.tasksService.getTask({ taskId, mainRoomId });
      this.logger.debug(
        `TaskMeta loaded: status=${meta.status}, totalRuns=${meta.totalRuns}, notificationPolicy=${meta.notificationPolicy}, consecutiveFailures=${meta.consecutiveFailures}`,
      );

      // 2. Guard: skip if not active/dry_run
      if (!isTaskRunnable(meta)) {
        this.logger.log(`Task ${taskId} status is '${meta.status}', skipping`);
        return;
      }

      const now = new Date();

      // 3. Send message based on notificationPolicy
      this.logger.debug(
        `Sending notification: policy=${meta.notificationPolicy}, isDryRun=${meta.status === 'dry_run'}, roomId=${roomId}`,
      );
      const notifEventId = await sendTaskNotification({
        roomId,
        matrixUserId,
        message,
        notificationPolicy: meta.notificationPolicy,
        isDryRun: meta.status === 'dry_run',
      });
      this.logger.debug(
        `Notification sent: eventId=${notifEventId ?? 'none (dry_run/silent)'}`,
      );

      // 4. Post task run event
      const runEventContent: TaskRunEventContent = {
        taskId,
        runAt: now.toISOString(),
        status: 'success',
        totalRuns: meta.totalRuns + 1,
        summary: message,
      };
      this.logger.debug(
        `Posting run event: ${JSON.stringify(runEventContent)}`,
      );
      const mxManager = MatrixManager.getInstance();
      await mxManager.sendMatrixEvent(
        roomId,
        TASK_RUN_EVENT_TYPE,
        runEventContent,
      );
      this.logger.debug(`Run event posted to room ${roomId}`);

      // 5. Update TaskMeta
      const updates = {
        lastRunAt: now.toISOString(),
        totalRuns: meta.totalRuns + 1,
        consecutiveFailures: 0,
      };
      this.logger.debug(`Updating TaskMeta: ${JSON.stringify(updates)}`);
      await this.tasksService.updateTask({
        taskId,
        mainRoomId,
        updates,
      });

      this.logger.log(
        `Simple job for task ${taskId} completed (run #${meta.totalRuns + 1})`,
      );
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
}
