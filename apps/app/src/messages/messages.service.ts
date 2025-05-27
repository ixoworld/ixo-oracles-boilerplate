import {
  type ListOracleMessagesResponse,
  ORACLE_SESSIONS_ROOM_NAME,
  SessionManagerService,
  transformGraphStateMessageToListMessageResponse,
} from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { ThinkingEvent, ToolCallEvent } from '@ixo/oracles-events';
import { type AIMessageChunk } from '@langchain/core/messages';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Response } from 'express';
import * as crypto from 'node:crypto';
import { CustomerSupportGraph } from 'src/graph';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { MatrixManagerRegistryService } from 'src/matrix-registry/matrix-manager-registry-service.service';
import { SseService } from 'src/sse/sse.service';
import { type ENV } from 'src/types';
import { StreamTagProcessor } from 'src/utils/thinking-filter-factory';
import { type ListMessagesDto } from './dto/list-messages.dto';
import { type SendMessagePayload } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly customerSupportGraph: CustomerSupportGraph,
    private readonly config: ConfigService<ENV>,
    private readonly sseService: SseService,
    private readonly matrixManagerRegistryService: MatrixManagerRegistryService,
  ) {}

  private async getSessionManagerService(
    matrixAccessToken: string,
  ): Promise<SessionManagerService> {
    const matrixManager =
      await this.matrixManagerRegistryService.getManager(matrixAccessToken);

    return new SessionManagerService(matrixManager);
  }

  public async listMessages(
    params: ListMessagesDto & {
      did: string;
      matrixAccessToken: string;
    },
  ): Promise<ListOracleMessagesResponse> {
    const { did, matrixAccessToken, sessionId } = params;
    if (!sessionId || !did || !matrixAccessToken) {
      throw new BadRequestException('Invalid parameters');
    }

    const sessionManagerService =
      await this.getSessionManagerService(matrixAccessToken);

    const roomId = await sessionManagerService.roomManager.getOrCreateRoom({
      did,
      oracleName: this.config.getOrThrow('ORACLE_NAME'),
      userAccessToken: matrixAccessToken,
    });

    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }

    const state = await this.customerSupportGraph.getGraphState({
      sessionId,
      did,
      matrixAccessToken,
      roomId,
    });
    if (!state || (state.config.did && state.config.did !== did)) {
      return transformGraphStateMessageToListMessageResponse([]);
    }
    return transformGraphStateMessageToListMessageResponse(state.messages);
  }

  public async sendMessage(
    params: SendMessagePayload & {
      res?: Response;
    },
  ): Promise<
    | undefined
    | {
        message: {
          type: string;
          content: string;
          id: string;
        };
        sessionId: string;
      }
  > {
    const { runnableConfig, sessionId } = await this.prepareForQuery(params);

    if (params.stream && params.res) {
      // SET the headers

      params.res.set({
        'X-Request-Id': runnableConfig.configurable.requestId,
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Request-Id',
      });

      params.res.flushHeaders();

      const stream = await this.customerSupportGraph.streamMessage(
        params.message,
        runnableConfig,
      );

      if (params.sessionId) {
        const toolCallEvent = new ToolCallEvent({
          connectionId: sessionId,
          requestId: runnableConfig.configurable.requestId ?? '',
          sessionId,
          toolName: 'toolName',
          args: 'args',
        });
        const thinkingEvent = new ThinkingEvent({
          message: '',
          connectionId: sessionId,
          requestId: runnableConfig.configurable.requestId ?? '',
          sessionId,
        });
        const filter = new StreamTagProcessor();
        let fullContent = '';
        for await (const { data, event } of stream) {
          if (event === 'on_chat_model_stream') {
            const content = (data.chunk as AIMessageChunk).content;

            const toolCall = (data.chunk as AIMessageChunk).tool_calls;

            toolCall?.forEach((tool) => {
              // update toolCallEvent with toolCall
              toolCallEvent.payload.toolName = tool.name;
              toolCallEvent.payload.args = tool.args;
              this.sseService.publishToSession(sessionId, toolCallEvent);
            });

            if (!content) {
              continue;
            }

            // append content to fullContent
            fullContent += content.toString();

            filter.processChunk(
              content.toString(),
              (filteredContent) => {
                params.res?.write(filteredContent);
              },
              (filteredThinking) => {
                thinkingEvent.appendMessage(filteredThinking);
                this.sseService.publishToSession(sessionId, thinkingEvent);
              },
            );
          }
        }
        filter.flush(
          (filteredContent) => {
            params.res?.write(filteredContent);
          },
          (filteredThinking) => {
            thinkingEvent.appendMessage(filteredThinking);
            this.sseService.publishToSession(sessionId, thinkingEvent);
          },
        );
        if (!fullContent.includes('<answer>')) {
          // send the full content as a message
          params.res.write(fullContent);
        }
        if (!params.res.writableEnded) {
          params.res.end();
        }
        return;
      }

      return;
    }

    const result = await this.customerSupportGraph.sendMessage(
      params.message,
      runnableConfig,
    );
    const lastMessage = result.messages.at(-1);
    if (!lastMessage) {
      throw new BadRequestException('No message returned from the oracle');
    }

    return {
      message: {
        type: lastMessage.getType(),
        content: lastMessage.content.toString(),
        id: lastMessage.id ?? '',
      },
      sessionId,
    };
  }

  private async prepareForQuery(payload: SendMessagePayload): Promise<{
    sessionId: string;
    config: TCustomerSupportGraphState['config'];
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
        ? (payload.requestId as string)
        : crypto.randomUUID();

    const sessionManagerService =
      await this.getSessionManagerService(accessToken);

    const [roomId, sessionsRoomId] = await Promise.all([
      sessionManagerService.roomManager.getOrCreateRoom({
        did,
        oracleName: this.config.getOrThrow('ORACLE_NAME'),
        userAccessToken: accessToken,
      }),
      sessionManagerService.roomManager.getOrCreateRoom({
        did,
        oracleName: ORACLE_SESSIONS_ROOM_NAME,
        userAccessToken: accessToken,
      }),
    ]);

    const { messages } = await this.listMessages({
      did,
      matrixAccessToken: accessToken,
      sessionId,
    });
    await sessionManagerService.syncSessionSet({
      sessionId,
      roomId: sessionsRoomId,
      oracleName: this.config.getOrThrow('ORACLE_NAME'),
      userAccessToken: accessToken,
      did,
      messages: messages.map((message) => message.content),
      oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
    });

    const config: TCustomerSupportGraphState['config'] = {
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
