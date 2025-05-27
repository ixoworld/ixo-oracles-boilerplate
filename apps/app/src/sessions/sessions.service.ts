import {
  SessionManagerService,
  type CreateChatSessionResponseDto,
  type ListChatSessionsResponseDto,
} from '@ixo/common'; // Assuming this path is correct
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatrixManagerRegistryService } from 'src/matrix-registry/matrix-manager-registry-service.service';
import { type ENV } from 'src/types';
import { type CreateSessionDto } from './dto/create-session.dto'; // Import DTO
import { type DeleteSessionDto } from './dto/delete-session.dto'; // Import DTO
import { type ListSessionsDto } from './dto/list-sessions.dto'; // Import DTO

@Injectable()
export class SessionsService {
  constructor(
    private readonly configService: ConfigService<ENV>,
    private readonly matrixManagerRegistryService: MatrixManagerRegistryService,
  ) {}

  private async getSessionManagerService(
    matrixAccessToken: string,
  ): Promise<SessionManagerService> {
    const matrixManager =
      await this.matrixManagerRegistryService.getManager(matrixAccessToken);

    return new SessionManagerService(matrixManager);
  }

  async createSession(
    data: CreateSessionDto,
  ): Promise<CreateChatSessionResponseDto> {
    try {
      //
      const sessionManager = await this.getSessionManagerService(
        data.matrixAccessToken,
      );

      const session = await sessionManager.createSession({
        did: data.did,
        matrixAccessToken: data.matrixAccessToken,
        oracleName: this.configService.getOrThrow('ORACLE_NAME'),
        oracleDid: this.configService.getOrThrow<string>('ORACLE_DID'),
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
      const sessionManager = await this.getSessionManagerService(
        data.matrixAccessToken,
      );

      const sessionsResult = await sessionManager.listSessions({
        matrixAccessToken: data.matrixAccessToken,
        did: data.did,
      });

      const oracleDid = this.configService.getOrThrow<string>('ORACLE_DID');

      // Sort sessions by lastUpdatedAt descending
      const sortedSessions = sessionsResult.sessions
        .filter((session) => session.oracleDid === oracleDid)
        .sort((a, b) => {
          // Assuming lastUpdatedAt is a valid date string or Date object
          return (
            new Date(b.lastUpdatedAt).getTime() -
            new Date(a.lastUpdatedAt).getTime()
          );
        });

      return { sessions: sortedSessions };
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
      const sessionManager = await this.getSessionManagerService(
        data.matrixAccessToken,
      );

      await sessionManager.deleteSession({
        matrixAccessToken: data.matrixAccessToken,
        did: data.did,
        sessionId: data.sessionId,
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
