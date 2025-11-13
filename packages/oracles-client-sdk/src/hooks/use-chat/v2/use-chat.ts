'use client';
import { useQuery } from '@tanstack/react-query';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useOraclesContext } from '../../../providers/oracles-provider/oracles-context.js';
import { getToolName } from '../../../utils/get-tool-name.js';
import { RequestError } from '../../../utils/request.js';
import {
  type SSEErrorEvent,
  type SSEReasoningEventData,
  type SSEToolCallPayload,
} from '../../../utils/sse-parser.js';
import { useOracleSessions } from '../../use-oracle-sessions/use-oracle-sessions.js';
import { useOraclesConfig } from '../../use-oracles-config.js';
import { useWebSocketEvents } from '../../use-websocket-events/use-websocket-events.js';
import { resolveContent } from '../resolve-content.js';
import transformToMessagesMap from '../transform-to-messages-map.js';
import { OracleChat } from './oracle-chat.js';
import { type AnyEvent, type IChatOptions, type IMessage } from './types.js';
import { useSendMessage } from './use-send-message.js';

export function useChat({
  oracleDid,
  sessionId,
  overrides,
  onPaymentRequiredError,
  browserTools,
  uiComponents,
  streamingMode,
}: IChatOptions) {
  // Create chat instance with lazy initialization
  const chatRef = useRef<OracleChat | null>(null);

  // Initialize or recreate chat if sessionId changes
  if (!chatRef.current || chatRef.current.id !== sessionId) {
    // Cleanup old instance to prevent memory leaks
    if (chatRef.current) {
      chatRef.current.cleanup();
    }

    chatRef.current = new OracleChat({
      oracleDid,
      sessionId,
      onPaymentRequiredError,
      browserTools,
      uiComponents,
      overrides,
      streamingMode,
    });
  }

  // Subscribe to messages with useSyncExternalStore
  const messages = useSyncExternalStore(
    chatRef.current.subscribe,
    () => chatRef.current?.messages ?? [],
    () => [], // Server snapshot (SSR)
  );

  const status = useSyncExternalStore(
    chatRef.current.subscribe,
    () => chatRef.current?.status,
    () => 'ready' as const,
  );

  const error = useSyncExternalStore(
    chatRef.current.subscribe,
    () => chatRef.current?.error,
    () => undefined,
  );

  const { refetch: refetchOracleSessions } = useOracleSessions(
    oracleDid,
    overrides,
  );
  const { config, isReady: isConfigReady } = useOraclesConfig(
    oracleDid,
    overrides,
  );
  const { authedRequest } = useOraclesContext();
  const getApiUrl = () => overrides?.baseUrl ?? config.apiUrl;

  // React Query for initial data fetch
  const {
    data,
    isLoading,
    error: queryError,
    status: queryStatus,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: [oracleDid, 'messages', sessionId],
    queryFn: async () => {
      const result = await authedRequest<{
        messages: IMessage[];
      }>(`${getApiUrl()}/messages/${sessionId}`, 'GET', {});

      const transformedMessages = transformToMessagesMap({
        messages: result.messages,
        uiComponents,
      });

      // Convert map to array and set initial messages
      const messagesArray = Object.values(transformedMessages);
      await chatRef.current?.setInitialMessages(messagesArray);

      return transformedMessages;
    },
    enabled: Boolean(sessionId && getApiUrl()),
    retry: false,
  });

  const revalidate = useCallback(async () => {
    await Promise.all([refetchMessages(), refetchOracleSessions()]);
  }, [refetchMessages, refetchOracleSessions]);

  // Sync React Query data with OracleChat state when data changes
  useEffect(() => {
    if (data && chatRef.current && queryStatus === 'success') {
      const messagesArray = Object.values(data);
      void chatRef.current.setInitialMessages(messagesArray);
    }
  }, [data, queryStatus]);

  // Handle tool call events from streaming
  const handleToolCall = useCallback(
    async (
      toolCallData: SSEToolCallPayload & {
        args: Record<string, unknown> & {
          toolName?: string;
        };
      },
    ) => {
      if (!uiComponents) return;

      const f: SSEToolCallPayload = {
        requestId: '37aedac3-9596-454f-ae2c-1ca35ac8434b',
        sessionId: '$zY04HX7zFT7RKKJFY3PTkQyoRsBBXWkh2lISLIOQnKY',
        toolName: 'toolCall',
        args: {
          query: 'personal information about the user',
          strategy: 'balanced',
          knowledge_level: 'user',
          toolName: 'mcp_memory-engine-http_memory_query',
        },
        status: 'isRunning',
        eventId: 'call_a5db5bf47c5945aea4',
      };

      const toolName = getToolName(
        toolCallData.toolName,
        (toolCallData.args as any)?.toolName,
      );

      const toolCallMessage: IMessage = {
        id: `${toolCallData.requestId}-ToolCall-${toolCallData.eventId}`,
        type: 'ai',
        content: resolveContent({
          eventName: 'tool_call',
          payload: toolCallData,
        }),
        toolCalls: [
          {
            id: toolCallData.eventId ?? toolCallData.requestId,
            name: toolName,
            args: toolCallData.args,
            status: toolCallData.status,
            output: toolCallData.output,
          },
        ],
      };

      await chatRef.current?.upsertEventMessage(toolCallMessage);
    },
    [uiComponents],
  );

  // Handle error events from streaming
  const handleError = useCallback(
    async (errorData: SSEErrorEvent) => {
      if (!uiComponents) return;

      const errorMessage: IMessage = {
        id: `${crypto.randomUUID()}-error`,
        type: 'ai',
        content: resolveContent({ eventName: 'error', payload: errorData }),
      };

      await chatRef.current?.addUserMessage(errorMessage);
    },
    [uiComponents],
  );

  // Handle reasoning events from streaming
  const handleReasoning = useCallback(
    async ({
      reasoningData,
    }: {
      reasoningData: SSEReasoningEventData;
      requestId: string;
    }) => {
      // Use consistent ID for all reasoning chunks from the same request

      // Create reasoning message - upsertEventMessage will handle accumulation
      const reasoningMessage: IMessage = {
        id: reasoningData.requestId,
        type: 'ai',
        content: reasoningData.reasoning,
        reasoning:
          reasoningData.reasoningDetails
            ?.map((detail) => detail.text)
            .filter((text) => text && text.trim().length > 0) // Filter out empty text
            .join('\n') || '', // Safe fallback to empty string
        isComplete: reasoningData.isComplete,
        isReasoning: true,
      };

      await chatRef.current?.upsertEventMessage(reasoningMessage);
    },
    [],
  );

  // Send message functionality
  const {
    sendMessage,
    abortStream,
    isSending,
    error: sendMessageError,
  } = useSendMessage({
    oracleDid,
    sessionId,
    overrides,
    onPaymentRequiredError,
    browserTools,
    chatRef: chatRef as MutableRefObject<OracleChat>,
    refetchQueries: revalidate,
    onToolCall: handleToolCall, // NEW
    onError: handleError, // NEW
    onReasoning: handleReasoning,
  });

  // WebSocket events handling (keep your existing logic)

  const handleNewEvent = useCallback(
    (event: AnyEvent) => {
      if (!uiComponents) return;
      // Process immediately when event arrives
      if (event.payload.sessionId === sessionId) {
        const messagePayload: IMessage = {
          id: `${event.payload.requestId}-${event.eventName}-${event.payload.eventId}`,
          type: 'ai',
          content: resolveContent({
            eventName: event.eventName,
            payload: event.payload,
          }),
          toolCalls:
            'toolName' in event.payload && 'status' in event.payload
              ? [
                  {
                    id: event.payload.requestId,
                    args: event.payload.args as Record<string, unknown>,
                    name: event.payload.toolName as string,
                    status: event.payload.status as 'isRunning' | 'done',
                    output:
                      'output' in event.payload
                        ? (event.payload.output as string)
                        : undefined,
                  },
                ]
              : undefined,
        };
        void chatRef.current?.upsertEventMessage(messagePayload);
      }
    },
    [sessionId, uiComponents],
  );

  // useLiveEvents removed - all events now come through streaming

  const { isConnected: isWebSocketConnected } = useWebSocketEvents({
    oracleDid,
    sessionId,
    overrides,
    handleInvalidateCache: () => {
      void revalidate();
    },
    handleNewEvent: (event) => {
      // Type assertion for WebSocket events
      handleNewEvent(event as AnyEvent);
    },
    browserTools,
  });

  // Cleanup on unmount to ensure garbage collection
  useEffect(() => {
    return () => {
      if (chatRef.current) {
        chatRef.current.cleanup();
        chatRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (queryError instanceof RequestError && queryError.outstandingClaims) {
      onPaymentRequiredError?.(queryError.outstandingClaims ?? []);
    }
  }, [queryError]);

  return {
    messages: messages ?? [],
    isLoading,
    error: error || queryError,
    isSending: isSending || status === 'streaming',
    sendMessage,
    abortStream,
    refetchMessages,
    sendMessageError,
    isRealTimeConnected: isWebSocketConnected,
    status,
    isConfigReady,
  };
}
