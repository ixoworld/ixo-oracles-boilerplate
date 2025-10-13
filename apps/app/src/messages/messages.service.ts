import {
  SessionManagerService,
  transformGraphStateMessageToListMessageResponse,
  type ListOracleMessagesResponse,
} from '@ixo/common';
import {
  type IRunnableConfigWithRequiredFields,
  type MatrixManager,
  type MessageEvent,
  type MessageEventContent,
} from '@ixo/matrix';
import { ToolCallEvent } from '@ixo/oracles-events';
import {
  type AIMessageChunk,
  type ToolMessage,
} from '@langchain/core/messages';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, type Response } from 'express';
import * as crypto from 'node:crypto';
import { CustomerSupportGraph } from 'src/graph';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { type ENV } from 'src/types';
import { normalizeDid } from 'src/utils/header.utils';
import { runWithSSEContext } from 'src/utils/sse-context';
import {
  formatSSE,
  sendSSEDone,
  sendSSEError,
  setSSEHeaders,
  startSSEHeartbeat,
} from 'src/utils/sse.utils';
import { type ListMessagesDto } from './dto/list-messages.dto';
import { type SendMessagePayload } from './dto/send-message.dto';

@Injectable()
export class MessagesService implements OnModuleInit, OnModuleDestroy {
  private cleanUpMatrixListener: () => void;
  private threadRootCache = new Map<string, string>(); // eventId → rootEventId

  matrixManager: MatrixManager;

  constructor(
    private readonly customerSupportGraph: CustomerSupportGraph,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
  ) {
    this.matrixManager = this.sessionManagerService.matrixManger;
  }

  public onModuleDestroy(): void {
    this.cleanUpMatrixListener();
  }

  private async getThreadRoot(
    event: MessageEvent<
      MessageEventContent & {
        'm.relates_to'?: {
          'm.in_reply_to'?: {
            event_id: string;
          };
        };
      }
    >,
    roomId: string,
  ): Promise<string | undefined> {
    const eventId = event.eventId;
    if (!eventId) {
      return undefined;
    }
    const inReplyTo =
      event.content['m.relates_to']?.['m.in_reply_to']?.event_id;

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

      // eslint-disable-next-line no-await-in-loop -- this is a loop function
      const parentEvent = await this.matrixManager.getEventById<{
        'm.relates_to'?: {
          'm.in_reply_to'?: {
            event_id: string;
          };
        };
      }>(roomId, currentEventId);

      const parentInReplyTo =
        parentEvent.content['m.relates_to']?.['m.in_reply_to']?.event_id;
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

  private async handleMessage(
    event: MessageEvent<MessageEventContent>,
    roomId: string,
  ): Promise<void> {
    const did = normalizeDid(event.sender);
    const isBot = did === this.config.getOrThrow('ORACLE_DID');
    if (isBot) {
      return;
    }

    if (
      event.content.msgtype === 'm.text' &&
      'body' in event.content &&
      typeof event.content.body === 'string' &&
      !('INTERNAL' in event.content)
    ) {
      const text = event.content.body;
      const threadId = await this.getThreadRoot(event, roomId);

      if (!threadId) {
        return;
      }

      try {
        const aiMessage = await this.sendMessage({
          message: text,
          did,
          sessionId: threadId,
          msgFromMatrixRoom: true,
          userMatrixOpenIdToken:""
        });
        if (!aiMessage) {
          return;
        }

        // Send AI response to Matrix
        await this.sessionManagerService.matrixManger.sendMessage({
          message: `${event.sender}: ${aiMessage.message.content}`,
          roomId,
          threadId,
          isOracleAdmin: true,
        });
      } catch (error) {
        Logger.error('Failed to send message', error);
        await this.sessionManagerService.matrixManger.sendMessage({
          message: `sorry, I'm having trouble processing your message. Please try again later.`,
          roomId,
          threadId,
          isOracleAdmin: true,
        });
      }
    }
  }

  public async onModuleInit(): Promise<void> {
    this.cleanUpMatrixListener =
      this.sessionManagerService.matrixManger.onMessage((roomId, event) => {
        this.handleMessage(event, roomId).catch((err) => {
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
        oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
      });

    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }

    const config: IRunnableConfigWithRequiredFields & { sessionId: string } = {
      configurable: {
        thread_id: sessionId,
        configs: {
          matrix: {
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
      req?: Request; // Express Request object for abort detection
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
    const { runnableConfig, sessionId, roomId, userContext } =
      await this.prepareForQuery(params);

    if (!params.msgFromMatrixRoom) {
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
    }
    if (params.stream && params.res) {
      // Set SSE headers
      setSSEHeaders(params.res, runnableConfig.configurable.requestId);
      params.res.flushHeaders();

      // Start heartbeat to keep connection alive
      const heartbeat = startSSEHeartbeat(params.res);

      // Create abort signal for request cancellation
      const abortController = new AbortController();

      // Listen for client disconnection and request abort
      const onClose = () => {
        abortController.abort();
      };
      const onAborted = () => {
        abortController.abort();
      };
      params.req?.on('close', onClose);
      params.req?.on('aborted', onAborted);

      try {
        await runWithSSEContext(params.res, async () => {
          const stream = await this.customerSupportGraph.streamMessage(
            params.message,
            runnableConfig,
            params.tools ?? [],
            params.msgFromMatrixRoom,
            userContext,
          );

          let fullContent = '';
          if (params.sessionId) {
            const toolCallMap = new Map<string, ToolCallEvent>();
            for await (const { data, event, tags } of stream) {
              // Stop processing if client aborted
              if (abortController.signal.aborted) {
                break;
              }
              const isChatNode = tags?.includes('chat_node');

              if (event === 'on_tool_end') {
                const toolMessage = data.output as ToolMessage;
                const toolCallEvent = toolCallMap.get(toolMessage.tool_call_id);
                if (!toolCallEvent) {
                  continue;
                }
                toolCallEvent.payload.output = toolMessage.content as string;
                toolCallEvent.payload.status = 'done';
                (
                  toolCallEvent.payload.args as Record<string, unknown>
                ).toolName = toolMessage.name;
                toolCallEvent.payload.eventId = toolMessage.tool_call_id;
                if (!params.res) {
                  throw new Error('Response not found');
                }
                // Send tool call completion event as SSE
                params.res.write(
                  formatSSE(toolCallEvent.eventName, toolCallEvent.payload),
                );
                toolCallMap.delete(toolMessage.tool_call_id);
              }

              if (event === 'on_chat_model_stream') {
                const content = (data.chunk as AIMessageChunk).content;
                const toolCall = (data.chunk as AIMessageChunk).tool_calls;

                toolCall?.forEach((tool) => {
                  // update toolCallEvent with toolCall
                  if (!tool.name.trim() || !tool.id) {
                    return;
                  }
                  const toolCallEvent = new ToolCallEvent({
                    requestId: runnableConfig.configurable.requestId ?? '',
                    sessionId,
                    toolName: 'toolCall',
                    args: {},
                    status: 'isRunning',
                  });
                  toolCallEvent.payload.args = tool.args;
                  (
                    toolCallEvent.payload.args as Record<string, unknown>
                  ).toolName = tool.name;
                  toolCallEvent.payload.eventId = tool.id;

                  // Send tool call start event as SSE
                  if (!params.res) {
                    throw new Error('Response not found');
                  }
                  params.res.write(
                    formatSSE(toolCallEvent.eventName, toolCallEvent.payload),
                  );
                  toolCallMap.set(tool.id, toolCallEvent);
                });

                if (!content) {
                  continue;
                }
                if (isChatNode) {
                  fullContent += content.toString();
                  // Send message chunk as SSE
                  if (!params.res) {
                    throw new Error('Response not found');
                  }
                  params.res.write(
                    formatSSE('message', {
                      content: content.toString(),
                      timestamp: new Date().toISOString(),
                    }),
                  );
                }
              }
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
          }

          // Send completion event only if not aborted
          if (!abortController.signal.aborted) {
            if (!params.res) {
              throw new Error('Response not found');
            }
            sendSSEDone(params.res);
          }
        });
        return;
      } catch (error) {
        Logger.error('Failed to stream message', error);
        sendSSEError(
          params.res,
          error instanceof Error ? error : 'Something went wrong',
        );
      } finally {
        // Clear heartbeat and end response
        clearInterval(heartbeat);
        // Remove listeners
        params.req?.off('close', onClose);
        params.req?.off('aborted', onAborted);
        if (!params.res.writableEnded) {
          params.res.end();
        }
      }
    }

    const result = await this.customerSupportGraph.sendMessage(
      params.message,
      runnableConfig,
      params.tools ?? [],
      params.msgFromMatrixRoom,
      userContext,
    );
    const lastMessage = result.messages.at(-1);
    if (!lastMessage) {
      throw new BadRequestException('No message returned from the oracle');
    }

    if (!params.msgFromMatrixRoom) {
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
    userContext?: TCustomerSupportGraphState['userContext'];
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
        oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
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
      oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
    });

    const targetSession = sessions.sessions.find(
      (session) => session.sessionId === sessionId,
    );

    let shouldTriggerMemoryAnalysis = false;

    Logger.log(
      `messages.length: ${messages.length}, targetSession?.lastProcessedCount: ${targetSession?.lastProcessedCount}`,
    );
  

    await this.sessionManagerService.syncSessionSet({
      sessionId,
      oracleName: this.config.getOrThrow('ORACLE_NAME'),
      did,
      messages: messages.map((message) => message.content),
      oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
      oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
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
            roomId,
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          },
          user: {
            did,
            matrixOpenIdToken: payload.userMatrixOpenIdToken,
          },
        },
      },
    };

    return {
      roomId,
      config,
      runnableConfig,
      sessionId,
      userContext: targetSession?.userContext,
    };
  }
}
