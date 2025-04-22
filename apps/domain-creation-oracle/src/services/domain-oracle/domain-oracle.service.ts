import { DomainCreationOracleState } from '@/domain-oracle-graph/state.js';
import {
  ListOracleMessagesResponse,
  ORACLE_SESSIONS_ROOM_NAME,
  SessionManagerService,
  transformGraphStateMessageToListMessageResponse,
} from '@ixo/common';
import { Logger } from '@ixo/logger';
import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { ToolCallEvent } from '@ixo/oracles-events/server';
import { AIMessageChunk } from '@langchain/core/messages';
import { Response } from 'express';
import httpErrors from 'http-errors';
import crypto from 'node:crypto';
import { ORACLE_NAME } from 'src/config.js';
import { domainCreationOracleGraph } from '../../domain-oracle-graph/index.js';
import sseService from '../sse/sse.service.js';
import { ListMessagesSchema, SendMessageSchema } from './schema.js';

export class DomainOracleService extends SessionManagerService {
  constructor(private readonly graph = domainCreationOracleGraph) {
    super();
  }

  public async listMessages(
    params: ListMessagesSchema,
  ): Promise<ListOracleMessagesResponse> {
    const { did, matrixAccessToken, sessionId } = params;

    const roomId = await this.roomManager.getRoomId({
      did,
      oracleName: ORACLE_NAME,
    });
    if (!roomId) {
      throw httpErrors.NotFound('Room not found or Invalid Session Id');
    }
    const isUserInRoom = await this.matrixManger.checkIsUserInRoom({
      userAccessToken: matrixAccessToken,
      roomId,
    });
    if (!isUserInRoom) {
      throw httpErrors.NotFound('User not in room');
    }
    const state = await this.graph.getGraphState({
      sessionId,
      did,
      matrixAccessToken,
      roomId,
    });
    if (!state) {
      return transformGraphStateMessageToListMessageResponse([]);
    }
    // if (state.config.did !== did) {
    //   throw httpErrors.NotFound('Session not found');
    // }
    return transformGraphStateMessageToListMessageResponse(state.messages);
  }

  public async sendMessage(
    params: SendMessageSchema & {
      matrixAccessToken: string;
      did: string;
      sessionId?: string;
      res?: Response;
    },
  ) {
    const { runnableConfig, sessionId, config } =
      await this.prepareForQuery(params);

    if (params.stream && params.res) {
      // SET the headers

      Logger.info('Setting request id', {
        requestId: runnableConfig.configurable.requestId,
      });
      params.res.set({
        'X-Request-Id': runnableConfig.configurable.requestId as string,
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Request-Id',
      });

      params.res.flushHeaders();

      // Ensure the connection stays open in some environments
      if (params.res.flush) {
        params.res.flush();
      }

      Logger.info('Streaming message');
      const stream = await this.graph.streamMessage(
        params.message,
        runnableConfig,
      );

      const sessionId = params.sessionId;

      if (sessionId && params.res) {
        const toolCallEvent = new ToolCallEvent({
          connectionId: sessionId,
          requestId: runnableConfig.configurable.requestId as string,
          sessionId,
          toolName: 'toolName',
          args: 'args',
        });
        for await (const { data, event } of stream) {
          if (event === 'on_chat_model_stream') {
            const content = (data.chunk as AIMessageChunk).content;
            const toolCall = (data.chunk as AIMessageChunk).tool_calls;

            toolCall?.forEach((tool) => {
              // update toolCallEvent with toolCall
              toolCallEvent.payload.toolName = tool.name;
              toolCallEvent.payload.args = tool.args;
              sseService.sendEvent(sessionId, toolCallEvent);
            });
            if (content) {
              params.res.write(content);
            }
          }
        }
        if (!params.res.writableEnded) {
          params.res.end();
        }
        return;
      }

      return;
    }

    const result = await this.graph.sendMessage(params.message, runnableConfig);
    const lastMessage = result.messages.at(-1);
    if (!lastMessage) {
      throw httpErrors.BadRequest('No message returned from the oracle');
    }

    return {
      message: {
        type: lastMessage?.getType(),
        content: lastMessage?.content.toString(),
        id: lastMessage?.id,
      },
      sessionId,
    };
  }

  private async prepareForQuery(
    payload: SendMessageSchema & {
      matrixAccessToken: string;
      did: string;
      sessionId?: string;
      requestId?: string;
    },
  ): Promise<{
    sessionId: string;
    config: DomainCreationOracleState['config'];
    roomId: string;
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    };
  }> {
    const accessToken = payload.matrixAccessToken;
    const did = payload.did;
    const sessionId = payload.sessionId || crypto.randomUUID();
    const requestId =
      payload.stream && 'requestId' in payload
        ? payload.requestId
        : crypto.randomUUID();
    const matrixManager = this.matrixManger;

    const [roomId, sessionsRoomId] = await Promise.all([
      this.roomManager.getOrCreateRoom({
        did,
        oracleName: ORACLE_NAME,
        userAccessToken: accessToken,
      }),
      this.roomManager.getOrCreateRoom({
        did,
        oracleName: ORACLE_SESSIONS_ROOM_NAME,
        userAccessToken: accessToken,
      }),
    ]);

    await matrixManager.init();
    const { messages } = await this.listMessages({
      did,
      matrixAccessToken: accessToken,
      sessionId,
    });
    const session = await this.syncSessionSet({
      sessionId,
      roomId: sessionsRoomId,
      oracleName: ORACLE_NAME,
      userAccessToken: accessToken,
      did,
      messages: messages.map((message) => message.content),
    });

    const config: DomainCreationOracleState['config'] = {
      did: payload.did,
    };

    const runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    } = {
      configurable: {
        requestId,
        sessionId,
        configs: {
          matrix: {
            accessToken,
            roomId,
          },
          user: {
            did,
          },
        },
      },
    };

    return {
      roomId,
      config,
      runnableConfig,
      sessionId,
    };
  }
}
