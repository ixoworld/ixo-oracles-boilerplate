'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { type IBrowserTools } from '../../types/browser-tool.type.js';
import { useLiveEvents } from '../use-live-events/use-live-events.hook.js';
import { useOraclesConfig } from '../use-oracles-config.js';
import { useWebSocketEvents } from '../use-websocket-events/use-websocket-events.js';
import { resolveContent } from './resolve-content.js';
import { type UIComponents } from './resolve-ui-component.js';
import transformToMessagesMap, {
  type IMessage,
  type MessagesMap,
} from './transform-to-messages-map.js';
import { useSendMessage } from './use-send-message.js';

export function useChat({
  oracleDid,
  sessionId,
  overrides,
  onPaymentRequiredError,
  ...props
}: {
  oracleDid: string;
  sessionId: string;
  onPaymentRequiredError: (claimIds: string[]) => void;
  browserTools?: IBrowserTools;
  uiComponents?: Partial<UIComponents>;
  overrides?: {
    baseUrl?: string;
    wsUrl?: string;
  };
}) {
  const uiComponents = useMemo(() => props.uiComponents, [props.uiComponents]);
  const {
    isSending,
    sendMessage,
    error: sendMessageError,
  } = useSendMessage({
    oracleDid,
    sessionId,
    overrides,
    onPaymentRequiredError,
    browserTools: props.browserTools,
  });
  const { config } = useOraclesConfig(oracleDid);
  const { authedRequest } = useOraclesContext();
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;
  const queryClient = useQueryClient();

  const {
    data: messagesMap,
    isLoading,
    error,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [oracleDid, 'messages', sessionId],
    queryFn: async () => {
      const result = await authedRequest<{
        messages: IMessage[];
      }>(`${apiUrl}/messages/${sessionId}`, 'GET');

      return transformToMessagesMap({
        messages: result.messages,
        uiComponents,
      });
    },
    enabled: Boolean(sessionId),
    retry: false,
  });

  // Convert MessagesMap to array using useMemo for better performance
  const messages = useMemo(() => {
    if (!messagesMap) return [];
    return Object.values(messagesMap);
  }, [messagesMap]);
  const revalidate = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const {
    events,
    isConnected,
    error: liveEventsError,
  } = useLiveEvents({
    oracleDid,
    sessionId,
    handleInvalidateCache: revalidate,
    overrides,
  });

  const { events: webSocketEvents, isConnected: isWebSocketConnected } =
    useWebSocketEvents({
      oracleDid,
      sessionId,
      overrides,
      handleInvalidateCache: revalidate,
      browserTools: props.browserTools,
    });

  useEffect(() => {
    if (events.length === 0 || !uiComponents || webSocketEvents.length === 0)
      return;
    if (liveEventsError) {
      return;
    }
    const eventsToHandle = [
      events[events.length - 1],
      webSocketEvents[webSocketEvents.length - 1],
    ];
    for (const event of eventsToHandle) {
      if (!event) return;

      const isRelated = event.payload.sessionId === sessionId;

      if (!isRelated) return;

      const messagePayload: IMessage = {
        id: `${event.payload.requestId}-${event.eventName}`,
        type: 'ai',
        content: resolveContent(event, uiComponents),
        toolCalls:
          'toolName' in event.payload
            ? [
                {
                  id: event.payload.requestId,
                  args: event.payload.args,
                  name: event.payload.toolName,
                  status: event.payload.status,
                },
              ]
            : undefined,
      };

      queryClient.setQueryData(
        [oracleDid, 'messages', sessionId],
        (old: MessagesMap = {}): MessagesMap => {
          return {
            ...old,
            [messagePayload.id]: messagePayload,
          };
        },
      );
    }
  }, [
    events,
    isRefetching,
    queryClient,
    sessionId,
    uiComponents,
    oracleDid,
    liveEventsError,
  ]);

  return {
    messages,
    isLoading,
    error,
    isSending,
    sendMessage,
    sendMessageError,
    isRealTimeConnected: isConnected && isWebSocketConnected,
  };
}
