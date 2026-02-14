import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { MessagesService } from '../messages/messages.service';
import { type ENV } from '../types';

export interface ProcessSessionHistoryParams {
  sessionId: string;
  did: string;
  oracleEntityDid: string;
  homeServer?: string;
}

@Injectable()
export class SessionHistoryProcessor {
  private readonly logger = new Logger(SessionHistoryProcessor.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly memoryEngineService: MemoryEngineService,
    private readonly sessionManagerService: SessionManagerService,
    private readonly configService: ConfigService<ENV>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Process session history by sending messages to memory engine
   * Uses cache locking to prevent concurrent processing
   */
  async processSessionHistory(
    params: ProcessSessionHistoryParams,
  ): Promise<void> {
    const cacheKey = `processing:session:${params.sessionId}`;
    const lockTtl = 5 * 60 * 1000; // 5 minutes
    const maxRetries = 3;
    const retryDelay = 10 * 1000; // 10 seconds

    // Check if already being processed
    const existingLock = await this.cacheManager.get(cacheKey);
    if (existingLock) {
      this.logger.debug(
        `Session ${params.sessionId} is already being processed, skipping`,
      );
      return;
    }

    // Set cache lock
    await this.cacheManager.set(cacheKey, true, lockTtl);

    try {
      await this.processSessionHistoryWithRetry(
        params,
        maxRetries,
        retryDelay,
      );
    } finally {
      // Always remove the lock
      await this.cacheManager.del(cacheKey);
    }
  }

  /**
   * Process session history with retry logic
   */
  private async processSessionHistoryWithRetry(
    params: ProcessSessionHistoryParams,
    maxRetries: number,
    retryDelay: number,
  ): Promise<void> {
    const { sessionId } = params;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.processSessionHistoryInternal(params);
        this.logger.log(
          `Successfully processed session history for session ${sessionId}`,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Attempt ${attempt}/${maxRetries} failed for session ${sessionId}:`,
          error,
        );

        if (attempt === maxRetries) {
          this.logger.error(
            `Failed to process session history for session ${sessionId} after ${maxRetries} attempts`,
            error,
          );
          throw error;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Internal method to process session history
   */
  private async processSessionHistoryInternal({
    sessionId,
    did,
    oracleEntityDid,
    homeServer,
  }: ProcessSessionHistoryParams): Promise<void> {
    this.logger.debug(`Processing session history for session ${sessionId}`);

    const session = await this.sessionManagerService.getSession(
      sessionId,
      did,
      false,
    );

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found, skipping processing`);
      return;
    }

    // Get room ID
    const userHomeServer = homeServer || await getMatrixHomeServerCroppedForDid(did);
    const { roomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomIdWithHomeServer({
        userDid: did,
        oracleEntityDid,
        userHomeServer,
      });

    if (!roomId) {
      this.logger.warn(
        `Room not found for session ${sessionId}, skipping processing`,
      );
      return;
    }

    // Get messages from the session
    const messagesResponse = await this.messagesService.listMessages({
      sessionId,
      did,
      homeServer,
    });

    if (!messagesResponse.messages || messagesResponse.messages.length === 0) {
      this.logger.debug(`No messages found for session ${sessionId}`);
      return;
    }

    // Filter messages since lastProcessedCount
    const lastProcessedCount = session.lastProcessedCount || 0;
    const newMessages = messagesResponse.messages.slice(lastProcessedCount);

    if (newMessages.length === 0) {
      this.logger.debug(
        `No new messages to process for session ${sessionId} (lastProcessedCount: ${lastProcessedCount})`,
      );
      return;
    }

    // Transform messages to memory engine format
    const transformedMessages = this.transformMessagesToMemoryEngineFormat(
      newMessages,
      session.title ?? '',
    );

    // Send to memory engine
    const oracleDid = this.configService.getOrThrow<string>('ORACLE_DID');
    const result = await this.memoryEngineService.processConversationHistory({
      messages: transformedMessages,
      userDid: did,
      oracleDid,
      roomId,
    });

    if (!result.success) {
      throw new Error('Failed to send messages to memory engine');
    }

    // Update session with new lastProcessedCount
    const newLastProcessedCount = lastProcessedCount + newMessages.length;
    await this.sessionManagerService.updateLastProcessedCount({
      sessionId,
      did,
      lastProcessedCount: newLastProcessedCount,
    });

    this.logger.log(
      `Processed ${newMessages.length} new messages for session ${sessionId}, updated lastProcessedCount to ${newLastProcessedCount}`,
    );
  }

  /**
   * Transform LangChain messages to memory engine format
   */
  private transformMessagesToMemoryEngineFormat(
    messages: Array<{ type: string; content: string }>,
    sessionTitle: string,
  ): Array<{
    content: string;
    role_type: 'user' | 'assistant' | 'system';
    role?: string;
    name?: string;
    source_description?: string;
  }> {
    return messages.map((message) => {
      let role_type: 'user' | 'assistant' | 'system';
      let role: string | undefined;
      let name: string | undefined;

      switch (message.type) {
        case 'human':
          role_type = 'user';
          role = 'user';
          name = 'User';
          break;
        case 'ai':
          role_type = 'assistant';
          role = 'assistant';
          name = 'AI Assistant';
          break;
        case 'system':
          role_type = 'system';
          role = 'system';
          name = 'System';
          break;
        case 'tool':
          // Map tool messages to assistant role since memory engine doesn't have tool role
          role_type = 'assistant';
          role = 'assistant';
          name = 'Tool Response';
          break;
        default:
          role_type = 'user';
          role = 'user';
          name = 'User';
      }

      return {
        content: message.content,
        role_type,
        role,
        name,
        source_description: `Chat Session: ${sessionTitle}`,
      };
    });
  }
}
