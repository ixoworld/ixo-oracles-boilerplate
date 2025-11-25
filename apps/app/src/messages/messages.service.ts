import {
  ChatSession,
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
import { ReasoningEvent, ToolCallEvent } from '@ixo/oracles-events';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import type { Request, Response } from 'express';
import { AIMessageChunk, ToolMessage } from 'langchain';
import * as crypto from 'node:crypto';
import { CustomerSupportGraph } from 'src/graph';
import { cleanAdditionalKwargs } from 'src/graph/nodes/chat-node/utils';
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
  private abortControllers = new Map<string, AbortController>(); // sessionId → AbortController

  matrixManager: MatrixManager;

  constructor(
    private readonly customerSupportGraph: CustomerSupportGraph,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.matrixManager = this.sessionManagerService.matrixManger;
  }

  public onModuleDestroy(): void {
    this.cleanUpMatrixListener();
  }

  /**
   * Get cached session or fetch from Matrix if not cached
   */
  private async getCachedSession(
    sessionId: string,
    did: string,
    oracleEntityDid: string,
  ): Promise<ChatSession | undefined> {
    const cacheKey = `session:${did}:${oracleEntityDid}:${sessionId}`;

    // Try to get from cache first
    const cachedSession = await this.cacheManager.get<ChatSession>(cacheKey);
    if (cachedSession) {
      Logger.debug(`Cache hit for session ${sessionId}`);
      return cachedSession;
    }

    // If not in cache, fetch from Matrix
    Logger.debug(`Cache miss for session ${sessionId}, fetching from Matrix`);
    const sessions = await this.sessionManagerService.listSessions({
      did,
      oracleEntityDid,
    });

    const session = sessions.sessions.find((s) => s.sessionId === sessionId);

    // Cache the session if found (with 5 minute TTL)
    if (session) {
      await this.cacheManager.set(cacheKey, session, 5 * 60 * 1000); // 5 minutes
    }

    return session;
  }

  /**
   * Invalidate session cache when session is updated
   */
  private async invalidateSessionCache(
    sessionId: string,
    did: string,
    oracleEntityDid: string,
  ): Promise<void> {
    const cacheKey = `session:${did}:${oracleEntityDid}:${sessionId}`;
    await this.cacheManager.del(cacheKey);
    Logger.debug(`Invalidated cache for session ${sessionId}`);
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
          clientType: 'matrix',
          message: text,
          did,
          sessionId: threadId,
          msgFromMatrixRoom: true,
          userMatrixOpenIdToken: '',
        });
        if (!aiMessage) {
          return;
        }

        // Send AI response to Matrix
        await this.sessionManagerService.matrixManger.sendMessage({
          message: aiMessage.message.content,
          roomId,
          threadId,
          isOracleAdmin: true,
          disablePrefix: true,
        });
      } catch (error) {
        Logger.error('Failed to send message', error);
        await this.sessionManagerService.matrixManger.sendMessage({
          message: `sorry, I'm having trouble processing your message. Please try again later.`,
          roomId,
          threadId,
          isOracleAdmin: true,
          disablePrefix: true,
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
    },
  ): Promise<ListOracleMessagesResponse> {
    const { did, sessionId } = params;
    if (!sessionId || !did) {
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
    console.log("🚀 ~ MessagesService ~ listMessages ~ state:", state)

    if (!state) {
      return transformGraphStateMessageToListMessageResponse([]);
    }
    return transformGraphStateMessageToListMessageResponse(state.messages);
  }

  public async sendMessage(
    params: SendMessagePayload & {
      res?: Response;
      clientType?: 'matrix' | 'slack';
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
    const { runnableConfig, sessionId, roomId, userContext, targetSession } =
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

      // Abort any existing request for this session (only one request per session at a time)
      const existingController = this.abortControllers.get(sessionId);
      if (existingController) {
        Logger.debug(`Aborting existing request for session ${sessionId}`);
        existingController.abort();
      }

      // Register abort controller for this session
      this.abortControllers.set(sessionId, abortController);

      // Listen for client disconnection - Response 'close' event is most reliable
      const onClose = () => {
        Logger.debug(
          `[MessagesService] Client disconnected, aborting stream. Signal already aborted: ${abortController.signal.aborted}`,
        );
        abortController.abort();
        Logger.debug(
          `[MessagesService] After abort(), signal.aborted: ${abortController.signal.aborted}`,
        );
      };

      // Listen to response close event (fires when client disconnects/aborts)
      params.res.on('close', onClose);

      try {
        await runWithSSEContext(
          params.res,
          async () => {
            const stream = await this.customerSupportGraph.streamMessage(
              params.message,
              runnableConfig,
              params.tools ?? [],
              params.msgFromMatrixRoom,
              userContext,
              abortController,
              params.metadata?.editorRoomId,
              params.metadata?.currentEntityDid,
            );

            let fullContent = '';
            if (params.sessionId) {
              const toolCallMap = new Map<string, ToolCallEvent>();
              for await (const { data, event, tags } of stream) {
                const isChatNode = true;

                if (event === 'on_tool_end') {
                  const toolMessage = data.output as ToolMessage;
                  const toolCallEvent = toolCallMap.get(
                    toolMessage.tool_call_id,
                  );
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
                  if (
                    !params.res.writableEnded &&
                    !abortController.signal.aborted
                  ) {
                    params.res.write(
                      formatSSE(toolCallEvent.eventName, toolCallEvent.payload),
                    );
                  }
                  toolCallMap.delete(toolMessage.tool_call_id);
                }

                if (event === 'on_chat_model_stream') {
                  const content = (data.chunk as AIMessageChunk).content;
                  const toolCall = (data.chunk as AIMessageChunk).tool_calls;

                  // Extract reasoning tokens from raw response
                  const rawResponse = (data.chunk as AIMessageChunk)
                    .additional_kwargs?.__raw_response as any;
                  if (
                    rawResponse?.choices?.[0]?.delta?.reasoning &&
                    isChatNode
                  ) {
                    const reasoning = rawResponse.choices[0].delta.reasoning;
                    const reasoningDetails =
                      rawResponse.choices[0].delta.reasoning_details;

                    if (reasoning && reasoning.trim()) {
                      // Use cleanAdditionalKwargs to extract and clean reasoning details
                      const cleanedKwargs = cleanAdditionalKwargs(
                        (data.chunk as AIMessageChunk).additional_kwargs,
                        params.msgFromMatrixRoom ?? false,
                      );

                      const reasoningEvent = ReasoningEvent.createChunk(
                        sessionId,
                        runnableConfig.configurable.requestId ?? '',
                        reasoning,
                        cleanedKwargs.reasoningDetails,
                        false, // Not complete yet
                      );

                      // Send reasoning chunk as SSE
                      if (!params.res) {
                        throw new Error('Response not found');
                      }
                      if (
                        !params.res.writableEnded &&
                        !abortController.signal.aborted
                      ) {
                        params.res.write(
                          formatSSE(
                            reasoningEvent.eventName,
                            reasoningEvent.payload,
                          ),
                        );
                      }
                    }
                  }

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
                    if (
                      !params.res.writableEnded &&
                      !abortController.signal.aborted
                    ) {
                      params.res.write(
                        formatSSE(
                          toolCallEvent.eventName,
                          toolCallEvent.payload,
                        ),
                      );
                    }
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
                    if (
                      !params.res.writableEnded &&
                      !abortController.signal.aborted
                    ) {
                      params.res.write(
                        formatSSE('message', {
                          content: content.toString(),
                          timestamp: new Date().toISOString(),
                        }),
                      );
                    }
                  }
                }
              }

              // Only send to Matrix if not aborted
              if (!abortController.signal.aborted && fullContent) {
                Logger.debug(
                  `[MessagesService] Sending AI response to Matrix (${fullContent.length} chars)`,
                );
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
              } else {
                Logger.debug(
                  `[MessagesService] Skipping Matrix send - aborted: ${abortController.signal.aborted}, content length: ${fullContent.length}`,
                );
              }
            }

            // Send completion event only if not aborted
            if (!abortController.signal.aborted) {
              if (!params.res) {
                throw new Error('Response not found');
              }

              // Send reasoning completion event
              const reasoningCompleteEvent = ReasoningEvent.createChunk(
                sessionId,
                runnableConfig.configurable.requestId ?? '',
                '', // Empty reasoning for completion
                undefined,
                true, // Mark as complete
              );

              if (!params.res.writableEnded) {
                params.res.write(
                  formatSSE(
                    reasoningCompleteEvent.eventName,
                    reasoningCompleteEvent.payload,
                  ),
                );
              }

              sendSSEDone(params.res);

              // Fire-and-forget post-message sync operations for streaming
              this.performPostMessageSync(
                params,
                sessionId,
                roomId,
                targetSession,
                [],
              );
            }
          },
          abortController,
        );
        return;
      } catch (error) {
        // Handle abort errors gracefully - don't treat as error
        if (
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.message.includes('aborted') ||
            error.message.includes('Stream aborted by client'))
        ) {
          Logger.debug(
            '[MessagesService] Stream aborted by client, exiting cleanly',
          );

          return;
        }

        // Only log and send error if it's not an abort
        Logger.error('Failed to stream message', error);
        Logger.error(
          `Error stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`,
        );
        if (!params.res.writableEnded && !abortController.signal.aborted) {
          sendSSEError(
            params.res,
            error instanceof Error ? error : 'Something went wrong',
          );
        }
      } finally {
        // Clear heartbeat and end response
        clearInterval(heartbeat);
        // Remove listener
        params.res.off('close', onClose);
        // Cleanup abort controller from registry
        this.abortControllers.delete(sessionId);
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
      params.metadata?.editorRoomId,
      params.metadata?.currentEntityDid,
      params.clientType,
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

    // Fire-and-forget post-message sync operations
    this.performPostMessageSync(
      params,
      sessionId,
      roomId,
      targetSession,
      result.messages,
    );

    return {
      message: {
        type: lastMessage.getType(),
        content: lastMessage.content.toString(),
        id: lastMessage.id ?? '',
      },
      sessionId,
    };
  }

  /**
   * Performs post-message sync operations in fire-and-forget mode
   * This includes session sync and async title updates
   */
  private performPostMessageSync(
    params: SendMessagePayload,
    sessionId: string,
    roomId: string,
    targetSession: any,
    messages: any[],
  ): void {
    // Run in background without blocking
    Promise.resolve().then(async () => {
      try {
        // Get current messages for sync
        const { messages: currentMessages } = await this.listMessages({
          did: params.did,
          sessionId,
        });

        // Sync session (fire-and-forget)
        await this.sessionManagerService.syncSessionSet({
          sessionId,
          oracleName: this.config.getOrThrow('ORACLE_NAME'),
          did: params.did,
          messages: currentMessages.map((message) => message.content),
          oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
          lastProcessedCount: targetSession?.lastProcessedCount ?? 0,
          roomId,
        });

        // Invalidate cache after session update
        await this.invalidateSessionCache(
          sessionId,
          params.did,
          this.config.getOrThrow('ORACLE_ENTITY_DID'),
        );

        // Note: Title updates are now handled by syncSessionSet when messages.length > 2
      } catch (error) {
        Logger.error('Failed to perform post-message sync:', error);
        // Don't throw - this is fire-and-forget
      }
    });
  }

  /**
   * Abort an ongoing stream request by sessionId
   */
  public abortRequest(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
      Logger.debug(`Aborted request for session ${sessionId}`);
      return true;
    }
    Logger.debug(`No active request found for session ${sessionId}`);
    return false;
  }

  /**
   * Extract timezone from payload (body) or request headers (fallback)
   * Body takes priority for backward compatibility with backends that don't support custom headers
   */
  private getTimezoneFromRequest(
    payload?: SendMessagePayload,
    req?: Request,
  ): string | undefined {
    // First check payload (body) - this is the primary source
    if (payload?.timezone) {
      return payload.timezone.trim() || undefined;
    }

    // Fallback to header if payload doesn't have it
    if (!req) {
      return undefined;
    }

    const timezoneHeader = req.headers['x-timezone'];
    if (!timezoneHeader) {
      return undefined;
    }

    // Handle both string and array formats
    const timezone =
      typeof timezoneHeader === 'string'
        ? timezoneHeader
        : Array.isArray(timezoneHeader)
          ? timezoneHeader[0]
          : undefined;

    return timezone?.trim() || undefined;
  }

  /**
   * Calculate current time in the user's timezone
   */
  private getCurrentTimeInTimezone(timezone: string): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });

      return formatter.format(now);
    } catch (error) {
      Logger.warn(
        `Failed to format time for timezone ${timezone}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fallback to UTC if timezone is invalid
      return new Date().toLocaleString('en-US', {
        timeZone: 'UTC',
        timeZoneName: 'short',
      });
    }
  }

  private async prepareForQuery(
    payload: SendMessagePayload & { req?: Request },
  ): Promise<{
    sessionId: string;
    config: TCustomerSupportGraphState['config'];
    roomId: string;
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    };
    userContext?: TCustomerSupportGraphState['userContext'];
    targetSession?: ChatSession; // For post-message sync
  }> {
    const did = payload.did;
    const sessionId = payload.sessionId;
    const requestId =
      payload.stream && 'requestId' in payload
        ? (payload.requestId as string)
        : crypto.randomUUID();

    // Get cached session to check for cached roomId
    const targetSession = await this.getCachedSession(
      sessionId,
      did,
      this.config.getOrThrow('ORACLE_ENTITY_DID'),
    );

    // Use cached roomId if available, otherwise fetch it
    let roomId = targetSession?.roomId;
    if (!roomId) {
      const roomResult =
        await this.sessionManagerService.matrixManger.getOracleRoomId({
          userDid: did,
          oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
        });
      roomId = roomResult.roomId;
      if (!roomId) {
        throw new NotFoundException('Room not found or Invalid Session Id');
      }
    }

    const config: TCustomerSupportGraphState['config'] = {
      did: payload.did,
    };

    // Extract timezone and calculate current time
    const timezone = this.getTimezoneFromRequest(payload, payload.req);
    const currentTime = timezone
      ? this.getCurrentTimeInTimezone(timezone)
      : undefined;

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
            ...(timezone && { timezone }),
            ...(currentTime && { currentTime }),
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
      targetSession,
    };
  }
}
