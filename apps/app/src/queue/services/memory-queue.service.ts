import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { type MemoryMessage } from 'src/graph/nodes/tools-node/matrix-memory';

export interface MemorySaveJobData {
  memories: MemoryMessage[];
  roomId: string;
  userDid: string;
  sessionId?: string;
}

@Injectable()
export class MemoryQueueService {
  private readonly logger = new Logger(MemoryQueueService.name);

  constructor(@InjectQueue('memory-queue') private memoryQueue: Queue) {}

  /**
   * Queue a single message for memory saving
   */
  async queueMessage(data: {
    content: string;
    roleType: 'user' | 'assistant' | 'system';
    name: string;
    roomId: string;
    userDid: string;
    sessionId?: string;
    timestamp?: string;
  }): Promise<void> {
    const memory: MemoryMessage = {
      content: data.content,
      role_type: data.roleType,
      name: data.name,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    await this.queueMemories({
      memories: [memory],
      roomId: data.roomId,
      userDid: data.userDid,
      sessionId: data.sessionId,
    });
  }

  /**
   * Queue multiple messages for bulk memory saving
   */
  async queueMemories(data: MemorySaveJobData): Promise<void> {
    try {
      const job = await this.memoryQueue.add('save-memories', data, {
        priority: 10,
        delay: 1000, // 1 second delay to allow batching
      });

      this.logger.log(
        `Queued ${data.memories.length} memories for saving (Job ID: ${job.id})`,
      );
    } catch (error) {
      this.logger.error('Failed to queue memories for saving:', error);
      throw error;
    }
  }

  /**
   * Queue conversation messages (human + AI response)
   */
  async queueConversation(data: {
    humanMessage: string;
    aiMessage: string;
    userName: string;
    aiName: string;
    roomId: string;
    userDid: string;
    sessionId?: string;
  }): Promise<void> {
    const timestamp = new Date().toISOString();

    const memories: MemoryMessage[] = [
      {
        content: data.humanMessage,
        role_type: 'user',
        name: data.userName,
        timestamp,
      },
      {
        content: data.aiMessage,
        role_type: 'assistant',
        name: data.aiName,
        timestamp,
      },
    ];

    await this.queueMemories({
      memories,
      roomId: data.roomId,
      userDid: data.userDid,
      sessionId: data.sessionId,
    });
  }

  /**
   * Get queue status and stats
   */
  async getQueueStatus() {
    const waiting = await this.memoryQueue.getWaiting();
    const active = await this.memoryQueue.getActive();
    const completed = await this.memoryQueue.getCompleted();
    const failed = await this.memoryQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }
}
