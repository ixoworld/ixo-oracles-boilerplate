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
import { RequestError } from '../../../utils/request.js';
import {
  type Event,
  useLiveEvents,
} from '../../use-live-events/use-live-events.hook.js';
import { useOracleSessions } from '../../use-oracle-sessions/use-oracle-sessions.js';
import { useOraclesConfig } from '../../use-oracles-config.js';
import { useWebSocketEvents } from '../../use-websocket-events/use-websocket-events.js';
import { resolveContent } from '../resolve-content.js';
import transformToMessagesMap from '../transform-to-messages-map.js';
import { OracleChat } from './oracle-chat.js';
import { type IChatOptions, type IMessage } from './types.js';
import { useSendMessage } from './use-send-message.js';

export function useChat({
  oracleDid,
  sessionId,
  overrides,
  onPaymentRequiredError,
  browserTools,
  uiComponents,
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
  const { config } = useOraclesConfig(oracleDid);
  const { authedRequest } = useOraclesContext();
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;

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
      }>(`${apiUrl}/messages/${sessionId}`, 'GET', {});

      const transformedMessages = transformToMessagesMap({
        messages: result.messages,
        uiComponents,
      });

      // Convert map to array and set initial messages
      const messagesArray = Object.values(transformedMessages);
      await chatRef.current?.setInitialMessages(messagesArray);

      return transformedMessages;
    },
    enabled: Boolean(sessionId && apiUrl),
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

  // Send message functionality
  const {
    sendMessage,
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
  });

  // WebSocket events handling (keep your existing logic)

  const handleNewEvent = useCallback(
    (event: Event) => {
      if (!uiComponents) return;
      // Process immediately when event arrives
      if (event.payload.sessionId === sessionId) {
        const messagePayload: IMessage = {
          id: `${event.payload.requestId}-${event.eventName}-${event.payload.eventId}`,
          type: 'ai',
          content: resolveContent(event, uiComponents),
          toolCalls:
            'toolName' in event.payload
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

  const { isConnected } = useLiveEvents({
    oracleDid,
    sessionId,
    handleInvalidateCache: () => {
      void revalidate();
    },
    handleNewEvent,
    overrides,
  });

  const { isConnected: isWebSocketConnected } = useWebSocketEvents({
    oracleDid,
    sessionId,
    overrides,
    handleInvalidateCache: () => {
      void revalidate();
    },
    handleNewEvent,
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
    refetchMessages,
    sendMessageError,
    isRealTimeConnected: isConnected && isWebSocketConnected,
    status,
  };
}
