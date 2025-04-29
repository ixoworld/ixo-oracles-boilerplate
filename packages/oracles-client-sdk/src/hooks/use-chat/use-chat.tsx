'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useLiveEvents } from '../use-live-events/use-live-events.hook.js';
import { useOraclesConfig } from '../use-oracles-config.js';
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
  ...props
}: {
  oracleDid: string;
  sessionId: string;
  uiComponents?: Partial<UIComponents>;
  overrides?: {
    baseUrl?: string;
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
  });
  const { config } = useOraclesConfig(oracleDid);
  const { authedRequest } = useOraclesContext();
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;
  const queryClient = useQueryClient();

  const { isLoading, error, isRefetching, refetch } = useQuery({
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
  });

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

  useEffect(() => {
    if (!events || !uiComponents) return;
    if (liveEventsError) {
      return;
    }
    const event = events[events.length - 1];
    if (!event) return;
    if (!event.payload.sessionId) {
      console.log('🚀 ~ useChat ~ event:', event);
      return;
    }
    const isRelated = event.payload.sessionId === sessionId;

    // if (!isRelated) return;

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
  }, [events, isRefetching, queryClient, sessionId]);

  const messagesState = queryClient.getQueryData<MessagesMap>([
    oracleDid,
    'messages',
    sessionId,
  ]);

  const messagesList = useMemo(
    () => Object.values(messagesState ?? {}),
    [messagesState],
  );

  return {
    messages: messagesList,
    isLoading,
    error,
    isSending,
    sendMessage,
    sendMessageError,
    isRealTimeConnected: isConnected,
  };
}
