import { MatrixManager } from '@ixo/matrix';
import { getChatOpenAiModel } from '../../ai/index.js';
import { RoomManagerService } from '../room-manager/room-manager.js';
import {
  type ChatSession,
  type CreateChatSessionDto,
  type CreateChatSessionResponseDto,
  type DeleteChatSessionDto,
  type ListChatSessionsDto,
  type ListChatSessionsResponseDto,
} from './dto.js';
import { NoUserRoomsFoundError, RoomNotFoundError } from './errors.js';

export const ORACLE_SESSIONS_ROOM_NAME = 'oracleSessions_sessions';
export class SessionManagerService {
  public readonly roomManager: RoomManagerService;
  constructor(public readonly matrixManger: MatrixManager) {
    this.roomManager = new RoomManagerService(matrixManger);
  }

  private async createMessageTitle({
    messages,
  }: {
    messages: string[];
  }): Promise<string> {
    if (messages.length === 0) {
      return 'Untitled';
    }
    const llm = getChatOpenAiModel();
    const response = await llm.invoke(
      `Based on this messages messages, Add a title for this convo and only based on the messages? MAKE SURE TO ONLY RESPOND WITH THE TITLE. <messages>\n\n${messages.join('\n\n')}</messages>
      
      ## RESPONSE FORMAT
      ONLY RESPOND WITH THE TITLE not anything else that title will be saved to the store directly from your response so generated based on the messages.
      
      `,
    );

    const title = response.content.toString();
    return title;
  }

  public async syncSessionSet({
    sessionId,
    roomId,
    oracleName,
    userAccessToken,
    did,
    messages,
    oracleDid,
  }: {
    sessionId: string;
    roomId: string;
    oracleName: string;
    userAccessToken: string;
    did: string;
    messages: string[];
    oracleDid: string;
  }): Promise<ChatSession> {
    const { sessions } = await this.listSessions({
      did,
      matrixAccessToken: userAccessToken,
    });

    const selectedSession = sessions.find((s) => s.sessionId === sessionId);
    if (!selectedSession) {
      const session: ChatSession = {
        sessionId,
        oracleName,
        title: await this.createMessageTitle({
          messages,
        }),
        lastUpdatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        oracleDid,
      };
      await this.matrixManger.stateManager.setState<ChatSession[]>({
        roomId,
        stateKey: ORACLE_SESSIONS_ROOM_NAME,
        data: [session, ...sessions],
      });

      return session;
    }

    const allowTitleUpdate = messages.length > 2;
    // update the session
    const title = allowTitleUpdate
      ? await this.createMessageTitle({
          messages,
        })
      : selectedSession.title;

    await this.matrixManger.stateManager.setState<ChatSession[]>({
      roomId,
      stateKey: ORACLE_SESSIONS_ROOM_NAME,
      data: sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              title,
              lastUpdateAt: new Date().toISOString(),
            }
          : session,
      ),
    });

    return {
      ...selectedSession,
      title,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  public async listSessions(
    listSessionsDto: ListChatSessionsDto,
  ): Promise<ListChatSessionsResponseDto> {
    const roomId = await this.roomManager.getOrCreateRoom({
      did: listSessionsDto.did,
      oracleName: ORACLE_SESSIONS_ROOM_NAME,
      userAccessToken: listSessionsDto.matrixAccessToken,
    });
    const room = this.matrixManger.getRoom(roomId);

    if (!room) {
      throw new RoomNotFoundError(roomId);
    }

    try {
      const sessionsState = await this.matrixManger.stateManager.getState<
        ChatSession[]
      >(roomId, ORACLE_SESSIONS_ROOM_NAME);
      return { sessions: sessionsState };
    } catch (error) {
      if (
        error instanceof Error &&
        'errcode' in error &&
        error.errcode === 'M_NOT_FOUND'
      ) {
        return { sessions: [] };
      }
      throw error;
    }
  }

  public async createSession(
    createSessionDto: CreateChatSessionDto,
  ): Promise<CreateChatSessionResponseDto> {
    const sessionId = crypto.randomUUID();

    const roomId = await this.roomManager.getOrCreateRoom({
      did: createSessionDto.did,
      oracleName: ORACLE_SESSIONS_ROOM_NAME,
      userAccessToken: createSessionDto.matrixAccessToken,
    });

    const session = await this.syncSessionSet({
      sessionId,
      roomId,
      oracleName: createSessionDto.oracleName,
      userAccessToken: createSessionDto.matrixAccessToken,
      did: createSessionDto.did,
      oracleDid: createSessionDto.oracleDid,
      messages: [],
    });

    return session;
  }

  public async deleteSession(
    deleteSessionDto: DeleteChatSessionDto,
  ): Promise<void> {
    const oldSessions = await this.listSessions({
      did: deleteSessionDto.did,
      matrixAccessToken: deleteSessionDto.matrixAccessToken,
    });

    const roomId = await this.matrixManger.getRoomId({
      did: deleteSessionDto.did,
      oracleName: ORACLE_SESSIONS_ROOM_NAME,
    });

    if (!roomId) {
      throw new NoUserRoomsFoundError(deleteSessionDto.did);
    }

    const newSessions = oldSessions.sessions.filter(
      (session) => session.sessionId !== deleteSessionDto.sessionId,
    );

    await this.matrixManger.stateManager.setState<ChatSession[]>({
      roomId,
      stateKey: ORACLE_SESSIONS_ROOM_NAME,
      data: newSessions,
    });
  }
}
