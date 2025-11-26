import { EncryptedRoomEvent, MatrixManager } from '@ixo/matrix';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/config';
import { UserMatrixSqliteSyncService } from '../user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import {
  OraclesCallMatrixEventContent,
  SyncCallResponse,
} from './dto/sync-call';

import { validateSync } from 'class-validator';
import {
  GetEncryptionKeyDTO,
  GetEncryptionKeyResponse,
} from './dto/get-encrpytion-key';
import {
  Call,
  ListCallDto,
  ListCallResponse,
  MATRIX_STATE_KEY_ORACLES_CALLS,
  MatrixOraclesCallsListState,
} from './dto/list-call';
import { CallId } from './dto/types';
import { UpdateCallDto, UpdateCallResponse } from './dto/update-dto';
@Injectable()
export class CallsService {
  constructor(
    private readonly configService: ConfigService<ENV>,
    @Inject('MATRIX_MANAGER') private readonly matrixManager: MatrixManager,
    private readonly syncService: UserMatrixSqliteSyncService,
  ) {}

  private async updateMXCallsListState(
    callId: CallId,
    sessionId: string,
    roomId: string,
    userDid: string,
  ) {
    // Use SQLite
    await this.syncService.addCall(userDid, callId, sessionId);
  }
  async getEncryptionKey(
    dto: GetEncryptionKeyDTO,
  ): Promise<GetEncryptionKeyResponse> {
    validateSync(dto);

    if (
      dto.apiKey !== this.configService.getOrThrow('LIVE_AGENT_AUTH_API_KEY')
    ) {
      throw new UnauthorizedException('Invalid API key');
    }

    const [callEventId, roomId] = dto.callId.split('@');

    if (!roomId) {
      throw new NotFoundException(
        'Room ID not found for the given user and oracle',
      );
    }

    const callEvent =
      await this.matrixManager.getEventById<OraclesCallMatrixEventContent>(
        roomId,
        callEventId,
      );
    if (!callEvent) {
      throw new NotFoundException(
        `Call event with ID '${callEventId}' not found`,
      );
    }
    return {
      encryptionKey: callEvent.content.encryptionKey,
      oracleDid: this.configService.getOrThrow('ORACLE_DID'),
      userDid: callEvent.content.userDid,
    };
  }

  async syncCall({
    callId,
    userDid,
  }: {
    callId: CallId;
    userDid: string;
  }): Promise<SyncCallResponse> {
    if (!callId || !userDid) {
      throw new BadRequestException('Invalid parameters');
    }
    const [eventId, roomId] = callId.split('@');

    if (!roomId) {
      throw new NotFoundException(
        'Room ID not found for the given session and oracle',
      );
    }

    const callEvent =
      await this.matrixManager.getEventById<OraclesCallMatrixEventContent>(
        roomId,
        eventId,
      );
    if (!callEvent) {
      throw new NotFoundException(`Call event with ID '${callId}' not found`);
    }

    await this.updateMXCallsListState(
      callId,
      callEvent.content.sessionId,
      roomId,
      userDid,
    );

    return { callId };
  }

  async listCalls(dto: ListCallDto): Promise<ListCallResponse> {
    try {
      validateSync(dto);

      // Check SQLite first
      let callsRows = await this.syncService.listCalls(
        dto.userDid,
        dto.sessionId,
      );

      // If SQLite is empty, check Matrix and migrate
      if (callsRows.length === 0) {
        const { roomId } = await this.matrixManager.getOracleRoomId({
          userDid: dto.userDid,
          oracleEntityDid: this.configService.getOrThrow('ORACLE_ENTITY_DID'),
        });

        if (roomId) {
          // Migrate calls from Matrix to SQLite
          await this.syncService.migrateUserDataFromMatrix(
            dto.userDid,
            roomId,
            this.configService.getOrThrow('ORACLE_ENTITY_DID'),
          );

          // Read from SQLite again after migration
          callsRows = await this.syncService.listCalls(
            dto.userDid,
            dto.sessionId,
          );
        }
      }

      if (callsRows.length === 0) {
        return { calls: [] };
      }

      const { roomId } = await this.matrixManager.getOracleRoomId({
        userDid: dto.userDid,
        oracleEntityDid: this.configService.getOrThrow('ORACLE_ENTITY_DID'),
      });

      if (!roomId) {
        throw new NotFoundException(
          'Room ID not found for the given user and oracle',
        );
      }

      const mxClient = this.matrixManager.getClient()?.mxClient;
      const crypto = mxClient?.crypto;
      const events = await Promise.all(
        callsRows.map(async (call) => {
          const [callEventId] = call.call_id.split('@');
          if (!callEventId) {
            throw new NotFoundException(
              `Call event with ID '${call.call_id}' not found`,
            );
          }
          const callEvent = await this.matrixManager.getEventById<Call>(
            roomId,
            callEventId,
          );
          if (!callEvent) {
            throw new NotFoundException(
              `Call event with ID '${call.call_id}' not found`,
            );
          }
          const relations = await this.matrixManager
            .getClient()
            ?.mxClient.getRelationsForEvent(roomId, callEventId);
          if (relations?.chunk.length === 0) {
          return {
            ...callEvent.content,
            id: call.call_id as CallId,
          };
          }

          // Sort the chunk array by origin_server_ts descending and get the most recent chunk
          let latestRelation = undefined;
          if (
            relations &&
            Array.isArray(relations.chunk) &&
            relations.chunk.length > 0
          ) {
            const sortedChunks = relations.chunk.sort(
              (a, b) => b.origin_server_ts - a.origin_server_ts,
            );
            latestRelation = sortedChunks[0];
          }
          const encryptedEvent = new EncryptedRoomEvent(latestRelation);
          const decryptedEvent = await crypto?.decryptRoomEvent(
            encryptedEvent,
            roomId,
          );
          const newContent = decryptedEvent?.content?.[
            'm.new_content'
          ] as OraclesCallMatrixEventContent;
          return {
            ...callEvent.content,
            ...newContent,

            id: call.call_id as CallId,
          };
        }),
      );
      return {
        calls: events.reduce((acc, event) => {
          if (event.sessionId === dto.sessionId) {
            acc.push(event);
          }
          return acc;
        }, [] as Call[]),
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'errcode' in error &&
        error.errcode === 'M_NOT_FOUND'
      ) {
        {
          return { calls: [] };
        }
      }
      throw error;
    }
  }

  async updateCall({
    callId,
    updateCallDto,
  }: {
    callId: CallId;
    updateCallDto: UpdateCallDto;
  }): Promise<UpdateCallResponse> {
    const [callEventId, roomId] = callId.split('@');

    if (!roomId) {
      throw new NotFoundException(
        'Room ID not found for the given session and oracle',
      );
    }

    const callEvent =
      await this.matrixManager.getEventById<OraclesCallMatrixEventContent>(
        roomId,
        callEventId,
      );

    if (!callEvent) {
      throw new NotFoundException(`Call event with ID '${callId}' not found`);
    }

    const currentContent = callEvent.content;
    const currentStatus = currentContent.callStatus;
    const newStatus = updateCallDto.callStatus;
    console.log('🚀 ~ CallsService ~ updateCall ~ newStatus:', newStatus);

    // Validate state transitions
    if (newStatus) {
      this.validateStateTransition(currentStatus, newStatus);
    }

    // Build updated content with automatic timestamps
    const updatedContent = this.buildUpdatedCallContent(
      currentContent,
      updateCallDto,
    );

    // Create Matrix replacement event
    const replacementEvent = {
      msgtype: 'm.ixo.oracles_call',
      body: `* Call  status updated to ${updatedContent.callStatus}`,
      'm.new_content': updatedContent,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: callEventId,
      },
    };

    // Send the replacement event
    const newEventId = await this.matrixManager.sendMatrixEvent(
      roomId,
      callEvent.type,
      replacementEvent,
    );

    return {
      callId: `${newEventId}@${roomId}`,
      callStatus: updatedContent.callStatus as 'active' | 'ended',
    };
  }

  /**
   * Validates if a state transition is allowed
   */
  private validateStateTransition(
    currentStatus: 'active' | 'ended' | 'pending',
    newStatus: 'active' | 'ended',
  ): void {
    const validTransitions: Record<string, string[]> = {
      pending: ['active', 'ended'],
      active: ['ended'],
      ended: [], // Cannot transition from ended state
    };

    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid state transition: Cannot change from '${currentStatus}' to '${newStatus}'. ` +
          `Allowed transitions from '${currentStatus}': [${allowedTransitions.join(', ')}]`,
      );
    }
  }

  /**
   * Builds updated call content with automatic timestamp management
   */
  private buildUpdatedCallContent(
    currentContent: OraclesCallMatrixEventContent,
    updateDto: UpdateCallDto,
  ): OraclesCallMatrixEventContent {
    const updatedContent = { ...currentContent };
    const now = new Date().toISOString();

    // Handle status change with automatic timestamps
    if (updateDto.callStatus) {
      updatedContent.callStatus = updateDto.callStatus;

      // Auto-set timestamps based on status transitions
      if (updateDto.callStatus === 'active' && !updatedContent.callStartedAt) {
        updatedContent.callStartedAt = updateDto.callStartedAt || now;
      }

      if (updateDto.callStatus === 'ended' && !updatedContent.callEndedAt) {
        updatedContent.callEndedAt = updateDto.callEndedAt || now;
      }
    }

    // Allow manual timestamp overrides (with validation)
    if (updateDto.callStartedAt) {
      if (updatedContent.callStatus === 'pending') {
        throw new BadRequestException(
          'Cannot set callStartedAt for pending calls',
        );
      }
      updatedContent.callStartedAt = updateDto.callStartedAt;
    }

    if (updateDto.callEndedAt) {
      if (updatedContent.callStatus !== 'ended') {
        throw new BadRequestException(
          'Cannot set callEndedAt for non-ended calls',
        );
      }
      updatedContent.callEndedAt = updateDto.callEndedAt;
    }
    console.log(
      '🚀 ~ CallsService ~ buildUpdatedCallContent ~ updatedContent:',
      updatedContent,
    );

    // Validate timestamp logic
    this.validateTimestamps(updatedContent);
    console.log(
      '🚀 ~ CallsService ~ buildUpdatedCallContent ~ updatedContent:',
      updatedContent,
    );
    return updatedContent;
  }

  /**
   * Validates timestamp logic
   */
  private validateTimestamps(content: OraclesCallMatrixEventContent): void {
    const { callStartedAt, callEndedAt, callStatus } = content;

    // Ensure started timestamp exists for active/ended calls
    if ((callStatus === 'active' || callStatus === 'ended') && !callStartedAt) {
      throw new ConflictException(
        `Calls with status '${callStatus}' must have callStartedAt timestamp`,
      );
    }

    // Ensure ended timestamp exists for ended calls
    if (callStatus === 'ended' && !callEndedAt) {
      throw new ConflictException(
        'Ended calls must have callEndedAt timestamp',
      );
    }

    // Ensure end time is after start time
    if (callStartedAt && callEndedAt) {
      const startTime = new Date(callStartedAt);
      const endTime = new Date(callEndedAt);

      if (endTime <= startTime) {
        throw new BadRequestException(
          'callEndedAt must be after callStartedAt',
        );
      }
    }
  }
}
