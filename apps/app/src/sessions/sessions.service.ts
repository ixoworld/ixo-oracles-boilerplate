import {
  type CreateChatSessionResponseDto,
  type ListChatSessionsResponseDto,
  SessionManagerService,
} from '@ixo/common';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { type CreateSessionDto } from './dto/create-session.dto'; // Import DTO
import { type DeleteSessionDto } from './dto/delete-session.dto'; // Import DTO
import { type ListSessionsDto } from './dto/list-sessions.dto'; // Import DTO
import { SessionHistoryProcessor } from './session-history-processor.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly configService: ConfigService<ENV>,
    private readonly sessionHistoryProcessor: SessionHistoryProcessor,
  ) {}

  async processPreviousSessionHistory(data: CreateSessionDto): Promise<void> {
    const oracleEntityDid = this.configService.getOrThrow('ORACLE_ENTITY_DID');

    // Process previous session history before creating new session
    const { sessions } = await this.listSessions({
      did: data.did,
    });

    if (sessions.length > 0) {
      const previousSession = sessions[0]; // Most recent session
      // Fire-and-forget processing of previous session
      this.sessionHistoryProcessor
        .processSessionHistory({
          sessionId: previousSession.sessionId,
          did: data.did,
          oracleEntityDid,
          homeServer: data.homeServer,
        })
        .catch((err) =>
          Logger.error(
            `Failed to process previous session ${previousSession.sessionId}:`,
            err,
          ),
        );
    }
  }

  async createSession(
    data: CreateSessionDto,
  ): Promise<CreateChatSessionResponseDto> {
    try {
      const oracleEntityDid =
        this.configService.getOrThrow('ORACLE_ENTITY_DID');

      this.processPreviousSessionHistory(data).catch((err) =>
        Logger.error(
          `Failed to process previous session history for DID ${data.did}:`,
          err,
        ),
      );

      const session = await this.sessionManager.createSession({
        did: data.did,
        homeServer: data.homeServer,
        oracleName: this.configService.getOrThrow('ORACLE_NAME'),
        oracleEntityDid,
        oracleDid: this.configService.getOrThrow('ORACLE_DID'),
        slackThreadTs: data.slackThreadTs,
      });
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      Logger.error(
        `Failed to create session for DID ${data.did}: ${message}`,
        stack,
      );
      throw new BadRequestException(`Session creation failed: ${message}`);
    }
  }

  async listSessions(
    data: ListSessionsDto,
  ): Promise<ListChatSessionsResponseDto> {
    try {
      const sessionsResult = await this.sessionManager.listSessions({
        did: data.did,
        oracleEntityDid: this.configService.getOrThrow('ORACLE_ENTITY_DID'),
        limit: data.limit ?? 20,
        offset: data.offset ?? 0,
      });

      return {
        sessions: sessionsResult.sessions,
        total: sessionsResult.total,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      Logger.error(
        `Failed to list sessions for DID ${data.did}: ${message}`,
        stack,
      );
      throw new BadRequestException(`Failed to list sessions: ${message}`);
    }
  }

  async deleteSession(data: DeleteSessionDto): Promise<{ message: string }> {
    try {
      const oracleEntityDid =
        this.configService.getOrThrow('ORACLE_ENTITY_DID');

      // Process session history before deletion
      this.sessionHistoryProcessor
        .processSessionHistory({
          sessionId: data.sessionId,
          did: data.did,
          oracleEntityDid,
          homeServer: data.homeServer,
        })
        .catch((err) =>
          Logger.error(
            `Failed to process deleted session ${data.sessionId}:`,
            err,
          ),
        );

      await this.sessionManager.deleteSession({
        did: data.did,
        sessionId: data.sessionId,
        oracleEntityDid,
      });
      return { message: 'Session deleted successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      Logger.error(
        `Failed to delete session ${data.sessionId} for DID ${data.did}: ${message}`,
        stack,
      );
      throw new BadRequestException(`Failed to delete session: ${message}`);
    }
  }
}
