import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { sendBulkSave } from 'src/graph/nodes/tools-node/matrix-memory';
import { type MemorySaveJobData } from '../services/memory-queue.service';

@Processor('memory-queue')
export class MemoryQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryQueueProcessor.name);

  async process(job: Job<MemorySaveJobData>): Promise<void> {
    const { memories, roomId, userDid, sessionId } = job.data;

    this.logger.log(
      `Processing memory save job ${job.id} - ${memories.length} memories for user ${userDid}`,
    );

    try {
      // Use the matrix-memory tool to save memories
      await sendBulkSave({
        memories,
        roomId,
        userDid,
      });

      this.logger.log(
        `Successfully saved ${memories.length} memories for user ${userDid} (Session: ${sessionId || 'none'})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save memories for user ${userDid}:`,
        error instanceof Error ? error.message : error,
      );

      // Log detailed error for debugging
      this.logger.debug('Memory save error details:', {
        jobId: job.id,
        userDid,
        roomId,
        sessionId,
        memoriesCount: memories.length,
        error: error instanceof Error ? error.stack : error,
      });

      // Re-throw to mark job as failed
      throw error;
    }
  }

  /**
   * Handle job completion
   */
  onCompleted(job: Job<MemorySaveJobData>) {
    this.logger.debug(
      `Memory save job ${job.id} completed for ${job.data.memories.length} memories`,
    );
  }

  /**
   * Handle job failure
   */
  onFailed(job: Job<MemorySaveJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Memory save job ${job.id} failed after ${job.attemptsMade} attempts:`,
        error.message,
      );
    } else {
      this.logger.error('Memory save job failed:', error.message);
    }
  }

  /**
   * Handle job stalling
   */
  onStalled(job: Job<MemorySaveJobData>) {
    this.logger.warn(`Memory save job ${job.id} stalled`);
  }
}
