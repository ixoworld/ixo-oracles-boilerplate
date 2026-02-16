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
import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';
import {
  ActionCallEvent,
  ReasoningEvent,
  ToolCallEvent,
} from '@ixo/oracles-events';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AIMessageChunk, ToolMessage } from 'langchain';
import * as crypto from 'node:crypto';
import { MainAgentGraph } from 'src/graph';
import { cleanAdditionalKwargs } from 'src/graph/nodes/chat-node/utils';
import { type TMainAgentGraphState } from 'src/graph/state';
import { type ENV } from 'src/types';
import { UcanService } from 'src/ucan/ucan.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
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
    private readonly mainAgent: MainAgentGraph,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
    private readonly checkpointStorageSyncService: UserMatrixSqliteSyncService,
    @Optional() private readonly ucanService?: UcanService,
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
        const homeServer = event.sender.split(':')[1];
        const aiMessage = await this.sendMessage({
          clientType: 'matrix',
          message: text,
          did,
          sessionId: threadId,
          homeServer,
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
      homeServer?: string;
    },
  ): Promise<ListOracleMessagesResponse> {
    const { did, sessionId, homeServer } = params;
    if (!sessionId || !did) {
      throw new BadRequestException('Invalid parameters');
    }

    this.checkpointStorageSyncService.markUserActive(did);
    try {
      const userHomeServer =
        homeServer || (await getMatrixHomeServerCroppedForDid(did));
      const { roomId } =
        await this.sessionManagerService.matrixManger.getOracleRoomIdWithHomeServer(
          {
            userDid: did,
            oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
            userHomeServer,
          },
        );

      if (!roomId) {
        throw new NotFoundException('Room not found or Invalid Session Id');
      }

      const config: IRunnableConfigWithRequiredFields & { sessionId: string } =
        {
          configurable: {
            thread_id: sessionId,
            configs: {
              matrix: {
                roomId,
                oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
                homeServerName: userHomeServer,
              },
              user: {
                did,
              },
            },
          },
          sessionId,
        };

      const state = await this.mainAgent.getGraphState(config);

      if (!state) {
        return transformGraphStateMessageToListMessageResponse([]);
      }
      return transformGraphStateMessageToListMessageResponse(state.messages);
    } finally {
      this.checkpointStorageSyncService.markUserInactive(did);
    }
  }

  public async sendMessage(
    params: SendMessagePayload & {
      res?: Response;
      clientType?: 'matrix' | 'slack';
      msgFromMatrixRoom?: boolean;
      req?: Request;
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
    // Mark user as active to prevent cron from closing their DB connection
    // Must be set BEFORE prepareForQuery which calls getUserDatabase
    this.checkpointStorageSyncService.markUserActive(params.did);

    try {
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
              // send thinking event to give the user faster feedback
              const _thinkingEvent = ReasoningEvent.createChunk(
                sessionId,
                runnableConfig.configurable.requestId ?? '',
                'Thinking...',
                undefined,
                false,
              );

              const stream = await this.mainAgent.streamMessage(
                params.message,
                runnableConfig,
                params.tools ?? [],
                params.msgFromMatrixRoom,
                userContext,
                abortController,
                params.metadata?.editorRoomId,
                params.metadata?.currentEntityDid,
                params.agActions ?? [],
                // UCAN options for MCP tool authorization
                {
                  ucanService: this.ucanService,
                  mcpInvocations: params.mcpInvocations,
                },
              );

              let fullContent = '';
              if (params.sessionId) {
                const toolCallMap = new Map<string, ToolCallEvent>();
                const actionCallMap = new Map<string, ActionCallEvent>();
                // Get list of AG-UI action names for quick lookup
                const agActionNames = new Set(
                  (params.agActions ?? []).map((action) => action.name),
                );

                Logger.log(
                  `[streamMessage] AG-UI actions registered: ${Array.from(agActionNames).join(', ') || 'none'}`,
                );

                // eslint-disable-next-line no-useless-catch
                try {
                  for await (const { data, event, tags: _tags } of stream) {
                    const isChatNode = true;

                    if (event === 'on_tool_end') {
                      const toolMessage = data.output as ToolMessage;

                      // Check if this is an AG-UI action completion
                      const actionCallEvent = actionCallMap.get(
                        toolMessage.tool_call_id,
                      );

                      if (actionCallEvent) {
                        actionCallEvent.payload.output =
                          toolMessage.content as string;
                        actionCallEvent.payload.toolCallId =
                          toolMessage.tool_call_id;

                        // Check if the tool message content indicates an error
                        try {
                          const resultContent =
                            typeof toolMessage.content === 'string'
                              ? JSON.parse(toolMessage.content)
                              : toolMessage.content;

                          // Set status based on whether there's an error
                          if (
                            resultContent?.success === false ||
                            resultContent?.error
                          ) {
                            actionCallEvent.payload.status = 'error';
                            actionCallEvent.payload.error =
                              resultContent.error || 'Action failed';
                          } else {
                            actionCallEvent.payload.status = 'done';
                          }
                        } catch {
                          // If we can't parse, assume success
                          actionCallEvent.payload.status = 'done';
                        }

                        if (!params.res) {
                          throw new Error('Response not found');
                        }
                        // Send action call completion event as SSE
                        if (
                          !params.res.writableEnded &&
                          !abortController.signal.aborted
                        ) {
                          params.res.write(
                            formatSSE(
                              actionCallEvent.eventName,
                              actionCallEvent.payload,
                            ),
                          );
                        }
                        actionCallMap.delete(toolMessage.tool_call_id);
                        continue;
                      } else {
                        // Normal tool call handling
                        const toolCallEvent = toolCallMap.get(
                          toolMessage.tool_call_id,
                        );
                        if (!toolCallEvent) {
                          continue;
                        }
                        toolCallEvent.payload.output =
                          toolMessage.content as string;
                        toolCallEvent.payload.status = 'done';
                        (
                          toolCallEvent.payload.args as Record<string, unknown>
                        ).toolName = toolMessage.name;
                        toolCallEvent.payload.eventId =
                          toolMessage.tool_call_id;
                        if (!params.res) {
                          throw new Error('Response not found');
                        }
                        // Send tool call completion event as SSE
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
                        toolCallMap.delete(toolMessage.tool_call_id);
                        continue;
                      }
                    }

                    if (event === 'on_chat_model_stream') {
                      const content = (data.chunk as AIMessageChunk).content;
                      const toolCall = (data.chunk as AIMessageChunk)
                        .tool_calls;

                      // Extract reasoning tokens from raw response
                      const rawResponse = (data.chunk as AIMessageChunk)
                        .additional_kwargs?.__raw_response as
                        | {
                            choices?: Array<{
                              delta?: {
                                reasoning?: string;
                                reasoning_details?: unknown;
                              };
                            }>;
                          }
                        | undefined;
                      const reasoning =
                        rawResponse?.choices?.[0]?.delta?.reasoning;
                      if (reasoning && isChatNode) {
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

                        Logger.log(
                          `[streamMessage] Tool call detected: ${tool.name}, isAgAction: ${agActionNames.has(tool.name)}`,
                        );

                        // Check if this is an AG-UI action
                        if (agActionNames.has(tool.name)) {
                          // Create ActionCallEvent for SSE status update (no args - sent via WebSocket only)
                          const actionCallEvent = new ActionCallEvent({
                            requestId:
                              runnableConfig.configurable.requestId ?? '',
                            sessionId,
                            toolCallId: tool.id,
                            toolName: tool.name,
                            args: undefined, // Args sent via WebSocket only, not SSE
                            status: 'isRunning',
                          });

                          // Send action call start event as SSE
                          if (!params.res) {
                            throw new Error('Response not found');
                          }
                          if (
                            !params.res.writableEnded &&
                            !abortController.signal.aborted
                          ) {
                            params.res.write(
                              formatSSE(
                                actionCallEvent.eventName,
                                actionCallEvent.payload,
                              ),
                            );
                          }
                          actionCallMap.set(tool.id, actionCallEvent);
                        } else {
                          // Normal tool call handling
                          const toolCallEvent = new ToolCallEvent({
                            requestId:
                              runnableConfig.configurable.requestId ?? '',
                            sessionId,
                            toolName: 'toolCall',
                            args: {},
                            status: 'isRunning',
                          });
                          toolCallEvent.payload.args = tool.args;
                          (
                            toolCallEvent.payload.args as Record<
                              string,
                              unknown
                            >
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
                        }
                      });

                      if (!content) {
                        continue;
                      }
                      if (isChatNode) {
                        fullContent += String(content);
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
                              content: String(content),
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
                } catch (innerError) {
                  throw innerError;
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

                // Increment ref count BEFORE firing background task so
                // the outer finally's markUserInactive doesn't drop to 0
                // while performPostMessageSync still accesses the DB.
                this.checkpointStorageSyncService.markUserActive(params.did);
                this.performPostMessageSync(
                  params,
                  sessionId,
                  roomId,
                  targetSession,
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

            if (!params.res.writableEnded) {
              sendSSEDone(params.res);
            }
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
            sendSSEDone(params.res);
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

      const result = await this.mainAgent.sendMessage(
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
            message: String(lastMessage.content),
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

      // Increment ref count BEFORE firing background task so
      // the outer finally's markUserInactive doesn't drop to 0
      // while performPostMessageSync still accesses the DB.
      this.checkpointStorageSyncService.markUserActive(params.did);
      this.performPostMessageSync(params, sessionId, roomId, targetSession);

      return {
        message: {
          type: lastMessage.getType(),
          content: String(lastMessage.content),
          id: lastMessage.id ?? '',
        },
        sessionId,
      };
    } finally {
      // Mark user inactive so cron can safely manage their DB
      // Covers both streaming and non-streaming paths
      this.checkpointStorageSyncService.markUserInactive(params.did);
    }
  }

  /**
   * Fire-and-forget session synchronization after a message is sent.
   * Loads the latest session messages, persists them (plus oracle metadata and
   * lastProcessedCount) via SessionManagerService.
   */
  private performPostMessageSync(
    params: SendMessagePayload,
    sessionId: string,
    roomId: string,
    targetSession: ChatSession,
  ): void {
    // Run in background without blocking
    void Promise.resolve().then(async () => {
      try {
        const { messages: currentMessages } = await this.listMessages({
          did: params.did,
          sessionId,
          homeServer: params.homeServer,
        });
        // Sync session (fire-and-forget)
        await this.sessionManagerService.syncSessionSet({
          sessionId,
          oracleName: this.config.getOrThrow('ORACLE_NAME'),
          did: params.did,
          messages: currentMessages.map((message) =>
            message.content.toString(),
          ),
          oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
          lastProcessedCount: targetSession?.lastProcessedCount ?? 0,
          roomId,
        });

        // Note: Title updates are now handled by syncSessionSet when messages.length > 2
      } catch (error) {
        Logger.error('Failed to perform post-message sync:', error);
        // Don't throw - this is fire-and-forget
      } finally {
        this.checkpointStorageSyncService.markUserInactive(params.did);
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
    roomId: string;
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    };
    userContext?: TMainAgentGraphState['userContext'];
    targetSession: ChatSession; // For post-message sync
  }> {
    const did = payload.did;
    const sessionId = payload.sessionId;
    const requestId =
      payload.stream && 'requestId' in payload
        ? (payload.requestId as string)
        : crypto.randomUUID();

    await this.checkpointStorageSyncService.syncLocalStorageFromMatrixStorage({
      userDid: did,
    });

    const targetSession = await this.sessionManagerService.getSession(
      sessionId,
      did,
      false,
    );

    if (!targetSession) {
      throw new NotFoundException('Session not found');
    }

    // Use cached roomId if available, otherwise fetch it
    let roomId = targetSession?.roomId;
    if (!roomId) {
      const userHomeServer =
        payload.homeServer || (await getMatrixHomeServerCroppedForDid(did));
      const roomResult =
        await this.sessionManagerService.matrixManger.getOracleRoomIdWithHomeServer(
          {
            userDid: did,
            oracleEntityDid: this.config.getOrThrow('ORACLE_ENTITY_DID'),
            userHomeServer,
          },
        );
      roomId = roomResult.roomId;
      if (!roomId) {
        throw new NotFoundException('Room not found or Invalid Session Id');
      }
    }

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
        thread_id: sessionId,
        requestId,
        sessionId,
        configs: {
          matrix: {
            roomId,
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
            homeServerName:
              payload.homeServer ||
              (await getMatrixHomeServerCroppedForDid(did)),
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
      runnableConfig,
      sessionId,
      userContext: targetSession?.userContext,
      targetSession,
    };
  }
}
