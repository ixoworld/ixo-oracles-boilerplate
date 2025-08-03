'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [messagesMap, setMessagesMap] = useState<MessagesMap>({});
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
    setMessagesMap,
  });
  const { config } = useOraclesConfig(oracleDid);
  const { authedRequest } = useOraclesContext();
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;

  const { isLoading, error, refetch, status, data } = useQuery({
    queryKey: [oracleDid, 'messages', sessionId],
    queryFn: async () => {
      const result = await authedRequest<{
        messages: IMessage[];
      }>(`${apiUrl}/messages/${sessionId}`, 'GET');

      const transformedMessages = transformToMessagesMap({
        messages: result.messages,
        uiComponents,
      });

      // Populate the message store with initial data

      return transformedMessages;
    },
    enabled: Boolean(sessionId),
    retry: false,
  });

  // const {
  //   events,
  //   isConnected,
  //   error: liveEventsError,
  // } = useLiveEvents({
  //   oracleDid,
  //   sessionId,
  //   handleInvalidateCache: () => {
  //     void revalidate();
  //   },
  //   overrides,
  // });

  // const { events: webSocketEvents, isConnected: isWebSocketConnected } =
  //   useWebSocketEvents({
  //     oracleDid,
  //     sessionId,
  //     overrides,
  //     handleInvalidateCache: () => {
  //       void revalidate();
  //     },
  //     browserTools: props.browserTools,
  //   });

  useEffect(() => {
    if (status === 'success') {
      console.log('🚀 ~ useEffect ~ data:');
      setMessagesMap(data);
    }
  }, [status, data]);

  const revalidate = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // useEffect(() => {
  //   const allEvents = [...events, ...webSocketEvents];
  //   if (!uiComponents || allEvents.length === 0) return;
  //   if (liveEventsError) {
  //     return;
  //   }
  //   for (const event of allEvents) {
  //     const isRelated = event.payload.sessionId === sessionId;

  //     if (!isRelated) {
  //       continue;
  //     }

  //     const messagePayload: IMessage = {
  //       id: `${event.payload.requestId}-${event.eventName}`,
  //       type: 'ai',
  //       content: resolveContent(event, uiComponents),
  //       toolCalls:
  //         'toolName' in event.payload
  //           ? [
  //               {
  //                 id: event.payload.requestId,
  //                 args: event.payload.args as Record<string, unknown>,
  //                 name: event.payload.toolName as string,
  //                 status: event.payload.status as 'isRunning' | 'done',
  //               },
  //             ]
  //           : undefined,
  //     };

  //     // Update the message store directly
  //     setMessagesMap((prev) => ({
  //       ...prev,
  //       [messagePayload.id]: messagePayload,
  //     }));
  //   }
  // }, [events, webSocketEvents, sessionId, uiComponents, liveEventsError]);

  const messages = useMemo(() => Object.values(messagesMap), [messagesMap]);

  return {
    messages,
    isLoading,
    error,
    isSending,
    sendMessage,
    sendMessageError,
    // isRealTimeConnected: isConnected && isWebSocketConnected,
  };
}
