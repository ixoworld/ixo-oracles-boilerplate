import {
  type ListOracleMessagesResponse,
  SessionManagerService,
  transformGraphStateMessageToListMessageResponse,
} from '@ixo/common';
import {
  type IRunnableConfigWithRequiredFields,
  type MatrixEvent,
  type Room,
} from '@ixo/matrix';
import { ToolCallEvent } from '@ixo/oracles-events';
import { type AIMessageChunk } from '@langchain/core/messages';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Response } from 'express';
import * as crypto from 'node:crypto';
import { CustomerSupportGraph } from 'src/graph';
import { triggerMemoryAnalysisWorkflow } from 'src/graph/nodes/tools-node/matrix-memory';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { SseService } from 'src/sse/sse.service';
import { type ENV } from 'src/types';
import { normalizeDid } from 'src/utils/header.utils';
import { type ListMessagesDto } from './dto/list-messages.dto';
import { type SendMessagePayload } from './dto/send-message.dto';

@Injectable()
export class MessagesService implements OnModuleInit, OnModuleDestroy {
  private cleanUpMatrixListener: () => void;
  private threadRootCache = new Map<string, string>(); // eventId → rootEventId

  constructor(
    private readonly customerSupportGraph: CustomerSupportGraph,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
    private readonly sseService: SseService,
  ) {}

  public onModuleDestroy(): void {
    this.cleanUpMatrixListener();
  }

  private getThreadRoot(event: MatrixEvent, room: Room): string | undefined {
    const eventId = event.event.event_id;
    if (!eventId) {
      return undefined;
    }
    const inReplyTo =
      event.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id;

    if (!inReplyTo) {
      // This event IS the root
      this.threadRootCache.set(eventId, eventId);
      return eventId;
    }

    // Check if we already know the parent's root
    if (this.threadRootCache.has(inReplyTo)) {
      const rootEventId = this.threadRootCache.get(inReplyTo);
      if (!rootEventId) {
        return undefined;
      }

      // Cache this event too while we're at it
      this.threadRootCache.set(eventId, rootEventId);

      Logger.log(`Cache hit for event ${eventId} with root ${rootEventId}`);
      return rootEventId;
    }

    // Need to walk up the chain
    const pathToCache: string[] = [eventId]; // Track events we visit
    let currentEventId = inReplyTo;
    const visited = new Set<string>();

    while (currentEventId && !visited.has(currentEventId)) {
      visited.add(currentEventId);
      pathToCache.push(currentEventId);

      // Check cache before doing expensive lookup
      if (this.threadRootCache.has(currentEventId)) {
        const rootEventId = this.threadRootCache.get(currentEventId);
        if (!rootEventId) {
          return undefined;
        }
        // Cache entire path we just discovered
        pathToCache.forEach((id) => this.threadRootCache.set(id, rootEventId));
        Logger.log(
          `Cache hit for event ${currentEventId} with root ${rootEventId}`,
        );
        return rootEventId;
      }

      const parentEvent = room.findEventById(currentEventId);
      if (!parentEvent) break;

      const parentInReplyTo =
        parentEvent.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id;
      if (!parentInReplyTo) {
        // Found the root!
        // eslint-disable-next-line @typescript-eslint/no-loop-func -- this is a loop function
        pathToCache.forEach((id) => {
          this.threadRootCache.set(id, currentEventId);
        });
        return currentEventId;
      }

      currentEventId = parentInReplyTo;
    }

    // Fallback
    const fallbackRoot = currentEventId || eventId;
    pathToCache.forEach((id) => this.threadRootCache.set(id, fallbackRoot));
    return fallbackRoot;
  }

  private async handleMessage(event: MatrixEvent, room: Room) {
    const roomId = room.roomId;

    const content = event.getContent();
    const did = normalizeDid(event.sender?.userId ?? '');
    const isBot = did === this.config.getOrThrow('ORACLE_DID');
    if (isBot) {
      return;
    }

    if (
      content.msgtype === 'm.text' &&
      'body' in content &&
      typeof content.body === 'string' &&
      !content.INTERNAL
    ) {
      const text = content.body;
      const threadId = this.getThreadRoot(event, room);

      if (!threadId) {
        return;
      }

      const aiMessage = await this.sendMessage({
        message: text,
        did,
        sessionId: threadId,
        msgFromMatrixRoom: true,
      });
      if (!aiMessage) {
        return;
      }

      // Send AI response to Matrix
      await this.sessionManagerService.matrixManger.sendMessage({
        message: `${event.sender?.userId}: ${aiMessage.message.content}`,
        roomId,
        threadId,
        isOracleAdmin: true,
      });

      // Queue the conversation for memory saving
      // try {
      //   await this.memoryQueueService.queueConversation({
      //     humanMessage: text,
      //     aiMessage: aiMessage.message.content,
      //     userName: event.sender?.userId || 'Unknown User',
      //     aiName: 'Oracle Assistant',
      //     roomId,
      //     userDid: did,
      //     sessionId: threadId,
      //   });
      // } catch (error) {
      //   Logger.error('Failed to queue conversation for memory saving:', error);
      //   // Don't throw - memory saving failure shouldn't break the conversation
      // }
    }
  }

  public async onModuleInit(): Promise<void> {
    this.cleanUpMatrixListener =
      await this.sessionManagerService.matrixManger.onMessage((event, room) => {
        this.handleMessage(event, room).catch((err) => {
          Logger.error(err);
        });
      });
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

    const { roomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomId({
        userDid: did,
        oracleDid: this.config.getOrThrow('ORACLE_DID'),
      });

    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }

    const config: IRunnableConfigWithRequiredFields & { sessionId: string } = {
      configurable: {
        thread_id: sessionId,
        configs: {
          matrix: {
            accessToken: matrixAccessToken,
            roomId,
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          },
          user: {
            did,
          },
        },
      },
      sessionId,
    };

    const state = await this.customerSupportGraph.getGraphState(config);
    if (!state || (state.config.did && state.config.did !== did)) {
      return transformGraphStateMessageToListMessageResponse([]);
    }
    return transformGraphStateMessageToListMessageResponse(state.messages);
  }

  public async sendMessage(
    params: SendMessagePayload & {
      res?: Response;
      msgFromMatrixRoom?: boolean;
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
    const { runnableConfig, sessionId, roomId } =
      await this.prepareForQuery(params);

    this.sessionManagerService.matrixManger
      .sendMessage({
        message: params.message,
        roomId,
        threadId: sessionId,
        isOracleAdmin: false,
      })
      .catch((err) => {
        Logger.error('Failed to replay API message to matrix room', err);
      });

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
        params.tools ?? [],
        params.msgFromMatrixRoom,
      );

      let fullContent = '';
      if (params.sessionId) {
        const toolCallEvent = new ToolCallEvent({
          requestId: runnableConfig.configurable.requestId ?? '',
          sessionId,
          toolName: 'toolName',
          args: 'args',
        });
        for await (const { data, event, tags } of stream) {
          const isChatNode = tags?.includes('chat_node');
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
            if (isChatNode) {
              fullContent += content.toString();
              params.res.write(content.toString());
            }
          }
        }

        if (!params.res.writableEnded) {
          params.res.end();
        }

        this.sessionManagerService.matrixManger
          .sendMessage({
            message: fullContent,
            roomId,
            threadId: sessionId,
            isOracleAdmin: true,
          })
          .catch((err) => {
            Logger.error(
              'Failed to replay API AI response message to matrix room',
              err,
            );
          });
        return;
      }

      return;
    }

    const result = await this.customerSupportGraph.sendMessage(
      params.message,
      runnableConfig,
      params.tools ?? [],
      params.msgFromMatrixRoom,
    );
    const lastMessage = result.messages.at(-1);
    if (!lastMessage) {
      throw new BadRequestException('No message returned from the oracle');
    }

    this.sessionManagerService.matrixManger
      .sendMessage({
        message: lastMessage.content.toString(),
        roomId,
        threadId: sessionId,
        isOracleAdmin: true,
      })
      .catch((err) => {
        Logger.error(
          'Failed to replay API AI response message to matrix room',
          err,
        );
      });

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
    const accessToken = this.config.getOrThrow<string>(
      'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
    );
    const did = payload.did;
    const sessionId = payload.sessionId || crypto.randomUUID();
    const requestId =
      payload.stream && 'requestId' in payload
        ? (payload.requestId as string)
        : crypto.randomUUID();

    const { roomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomId({
        userDid: did,
        oracleDid: this.config.getOrThrow('ORACLE_DID'),
      });
    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }
    const { messages } = await this.listMessages({
      did,
      matrixAccessToken: accessToken,
      sessionId,
    });

    const sessions = await this.sessionManagerService.listSessions({
      did,
      oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
    });

    const targetSession = sessions.sessions.find(
      (session) => session.sessionId === sessionId,
    );

    let shouldTriggerMemoryAnalysis = false;

    if (messages.length - (targetSession?.lastProcessedCount ?? 0) > 30) {
      try {
        shouldTriggerMemoryAnalysis = true;
        Logger.log('Triggering memory analysis workflow');
        await triggerMemoryAnalysisWorkflow({
          userDid: did,
          sessionId,
          oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          roomId,
        });
      } catch (error) {
        Logger.error('Failed to trigger memory analysis workflow:', error);
      }
    }

    await this.sessionManagerService.syncSessionSet({
      sessionId,
      oracleName: this.config.getOrThrow('ORACLE_NAME'),
      did,
      messages: messages.map((message) => message.content),
      oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
      lastProcessedCount: shouldTriggerMemoryAnalysis
        ? messages.length
        : (targetSession?.lastProcessedCount ?? 0),
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
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
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
