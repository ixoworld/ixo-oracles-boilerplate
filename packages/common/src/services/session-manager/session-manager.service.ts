import { Logger } from '@ixo/logger';
import { MatrixManager } from '@ixo/matrix';
import { getChatOpenAiModel } from '../../ai/index.js';
import { MemoryEngineService } from '../memory-engine/memory-engine.service.js';
import { type UserContextData } from '../memory-engine/types.js';
import {
  type ChatSession,
  type CreateChatSessionDto,
  type CreateChatSessionResponseDto,
  type DeleteChatSessionDto,
  type ListChatSessionsDto,
  type ListChatSessionsResponseDto,
} from './dto.js';
import { NoUserRoomsFoundError } from './errors.js';

export class SessionManagerService {
  constructor(
    public readonly matrixManger = MatrixManager.getInstance(),
    private readonly memoryEngineService?: MemoryEngineService,
  ) {}

  public getSessionsStateKey({
    oracleEntityDid,
  }: {
    oracleEntityDid: string;
  }): `${string}_${string}` {
    return `${oracleEntityDid}_sessions`;
  }

  private async createMessageTitle({
    messages,
  }: {
    messages: string[];
  }): Promise<string> {
    if (messages.length === 0) {
      return 'Untitled';
    }
    const llm = getChatOpenAiModel({
      model: 'meta-llama/llama-3.1-8b-instruct',
      temperature: 0.3,
      apiKey: process.env.OPEN_ROUTER_API_KEY,
      timeout: 20 * 1000 * 60, // 20 minutes
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
    });
    const response = await llm.invoke(
      `Based on this messages messages, Add a title for this convo and only based on the messages? MAKE SURE TO ONLY RESPOND WITH THE TITLE. 
      
      ## RESPONSE FORMAT
      ONLY RESPOND WITH THE TITLE not anything else that title will be saved to the store directly from your response so generated based on the messages.

      EXample

      Input:
      <messages>
      Hello, how are you?
      I'm good, thank you!
      did u see the new feature i added?
      yes but i didn't like it
      </messages>

      Output:
      Conversation about a new feature

      ___________________________________________________________

      Input:
      <messages>
      What are the store opening hours?
      We are open from 9am to 5pm, Monday to Friday.
      </messages>

      Output:
      Store Opening Hours Information
___________________________________________________________
      Input:
      <messages>
      Can you help me reset my password?
      Sure, I can assist you with that.
      </messages>

      Output:
      Password Reset Assistance

      ___________________________________________________________
      # the out put should be only the title not anything else that title will be saved to the store directly from your response so generated based on the messages.

      USER MESSAGES:
      <messages>
      ${messages.join('\n\n')}
      </messages>
      `,
    );

    const title = response.content.toString();
    return title;
  }

  public async syncSessionSet({
    sessionId,
    did,
    messages,
    oracleEntityDid,
    oracleName,
    roomId: _roomId,
    lastProcessedCount,
    oracleDid,
    userContext,
    slackThreadTs,
  }: {
    sessionId: string;
    did: string;
    messages: string[];
    oracleEntityDid: string;
    oracleName: string;
    roomId?: string;
    lastProcessedCount?: number;
    oracleDid: string;
    userContext?: UserContextData;
    slackThreadTs?: string;
  }): Promise<ChatSession> {
    const matrixManager = MatrixManager.getInstance();
    await matrixManager.init();

    const { sessions } = await this.listSessions({
      did,
      oracleEntityDid,
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
        oracleEntityDid,
        oracleDid,
        userContext,
        slackThreadTs,
      };

      if (!this.matrixManger.stateManager) {
        throw new Error('MatrixStateManager not initialized');
      }

      const { roomId } = await this.matrixManger.getOracleRoomId({
        userDid: did,
        oracleEntityDid,
      });
      if (!roomId) {
        throw new Error('Room ID not found');
      }
      await this.matrixManger.stateManager.setState<ChatSession[]>({
        roomId,
        stateKey: this.getSessionsStateKey({ oracleEntityDid }),
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

    if (!this.matrixManger.stateManager) {
      throw new Error('MatrixStateManager not initialized');
    }
    const { roomId } = _roomId
      ? { roomId: _roomId }
      : await this.matrixManger.getOracleRoomId({
          userDid: did,
          oracleEntityDid,
        });
    if (!roomId) {
      throw new Error('Room ID not found');
    }
    const lastUpdatedAt = new Date().toISOString();

    const setStatePromise = this.matrixManger.stateManager.setState<
      ChatSession[]
    >({
      roomId,
      stateKey: this.getSessionsStateKey({ oracleEntityDid }),
      data: sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              title,
              lastUpdatedAt,
              lastProcessedCount,
              slackThreadTs,
            }
          : session,
      ),
    });

    const editMessagePromise = this.matrixManger.editMessage({
      message: selectedSession.title ?? `New Conversation Started`,
      roomId,
      messageId: selectedSession.sessionId,
      isOracleAdmin: true,
      disablePrefix: true,
    });

    await Promise.all([setStatePromise, editMessagePromise]);

    return {
      ...selectedSession,
      title,
      lastUpdatedAt,
      lastProcessedCount,
    };
  }

  public async listSessions(
    listSessionsDto: ListChatSessionsDto,
  ): Promise<ListChatSessionsResponseDto> {
    await this.matrixManger.init();
    const { roomId } = await this.matrixManger.getOracleRoomId({
      userDid: listSessionsDto.did,
      oracleEntityDid: listSessionsDto.oracleEntityDid,
    });
    if (!roomId) {
      throw new Error('Room ID not found');
    }

    try {
      if (!this.matrixManger.stateManager) {
        throw new Error('MatrixStateManager not initialized');
      }
      const sessionsState = await this.matrixManger.stateManager.getState<
        ChatSession[]
      >(
        roomId,
        this.getSessionsStateKey({
          oracleEntityDid: listSessionsDto.oracleEntityDid,
        }),
      );
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
    // const sessionId = crypto.randomUUID();
    const { roomId } = await this.matrixManger.getOracleRoomId({
      userDid: createSessionDto.did,
      oracleEntityDid: createSessionDto.oracleEntityDid,
    });
    if (!roomId) {
      throw new Error('Room ID not found');
    }
    const eventId = (await this.matrixManger.sendMessage({
      message: 'New Conversation Started',
      roomId,
      isOracleAdmin: true,
    })) ?? {
      eventId: crypto.randomUUID(),
    };

    // Gather user context from Memory Engine
    let userContext: UserContextData | undefined;
    if (this.memoryEngineService) {
      try {
        Logger.info('Gathering user context from Memory Engine');
        userContext = await this.memoryEngineService.gatherUserContext({
          oracleDid: createSessionDto.oracleDid,
          userDid: createSessionDto.did,
          roomId,
        });
      } catch (error) {
        Logger.error('Failed to gather user context:', error);
        // Continue without user context
      }
    }

    const session = await this.syncSessionSet({
      sessionId: eventId,
      oracleName: createSessionDto.oracleName,
      did: createSessionDto.did,
      oracleEntityDid: createSessionDto.oracleEntityDid,
      oracleDid: createSessionDto.oracleDid,
      messages: [],
      roomId,
      userContext,
      slackThreadTs: createSessionDto.slackThreadTs,
    });

    return session;
  }

  public async deleteSession(
    deleteSessionDto: DeleteChatSessionDto,
  ): Promise<void> {
    const oldSessions = await this.listSessions({
      did: deleteSessionDto.did,
      oracleEntityDid: deleteSessionDto.oracleEntityDid,
    });

    const { roomId } = await this.matrixManger.getOracleRoomId({
      userDid: deleteSessionDto.did,
      oracleEntityDid: deleteSessionDto.oracleEntityDid,
    });

    if (!roomId) {
      throw new NoUserRoomsFoundError(deleteSessionDto.did);
    }

    const newSessions = oldSessions.sessions.filter(
      (session) => session.sessionId !== deleteSessionDto.sessionId,
    );

    if (!this.matrixManger.stateManager) {
      throw new Error('MatrixStateManager not initialized');
    }
    await this.matrixManger.stateManager.setState<ChatSession[]>({
      roomId,
      stateKey: this.getSessionsStateKey({
        oracleEntityDid: deleteSessionDto.oracleEntityDid,
      }),
      data: newSessions,
    });
  }
}
