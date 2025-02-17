'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { resolveContent } from '../../helpers/resolve-content';
import { useOraclesContext } from '../../oracles-provider';
import useLiveEvents from '../../use-live-events/use-live-events';
import { listMessages } from '../api';
import {
  type IMessage,
  type MessagesMap,
  type UseListMessagesProps,
} from '../types';
import { getMessagesQueryKey } from '../use-send-message/use-send-message';
import transformToMessagesMap from './transform-to-messages-map';

interface IUseListMessagesReturn {
  messages: IMessage[];
  isLoading: boolean;
  error: unknown;
}
export function useListMessages(
  props: UseListMessagesProps,
): IUseListMessagesReturn {
  const uiComponents = useMemo(() => props.uiComponents, [props.uiComponents]);

  const {
    apiKey,
    apiUrl,
    config: { did, matrixAccessToken },
    connectionId,
  } = useOraclesContext();

  const queryClient = useQueryClient();

  const { isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: getMessagesQueryKey({ sessionId: props.sessionId }),
    queryFn: async () => {
      const result = await listMessages({
        apiKey,
        apiUrl,
        did,
        matrixAccessToken,
        sessionId: props.sessionId,
        connectionId: connectionId ?? '',
      });

      return transformToMessagesMap({
        messages: result.messages,
        uiComponents,
      });
    },
    enabled: Boolean(props.sessionId),
  });

  const revalidate = useCallback(async () => {
    await refetch();
  }, [queryClient, props.sessionId]);

  const { events, getLatestEvent } = useLiveEvents({
    revalidate,
  });

  useEffect(() => {
    const event = getLatestEvent();
    if (!event || !uiComponents) return;

    const isRelated = event.payload.sessionId === props.sessionId;

    if (!isRelated) return;

    const messagePayload: IMessage = {
      id: event.payload.eventId ?? event.payload.requestId + event.eventName,
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
      getMessagesQueryKey({ sessionId: props.sessionId }),
      (old: MessagesMap = {}): MessagesMap => {
        return {
          ...old,
          [messagePayload.id]: messagePayload,
        };
      },
    );
  }, [events, isRefetching, queryClient, props.sessionId]);

  const messagesState = queryClient.getQueryData<MessagesMap>(
    getMessagesQueryKey({ sessionId: props.sessionId }),
  );

  const messagesList = useMemo(
    () => Object.values(messagesState ?? {}),
    [messagesState],
  );

  return {
    messages: messagesList,
    isLoading,
    error,
  };
}
