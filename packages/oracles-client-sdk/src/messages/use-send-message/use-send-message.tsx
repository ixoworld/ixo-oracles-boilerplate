import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useOraclesContext } from '../../oracles-provider';
import { getSessionsQueryKey } from '../../sessions';
import {
  type IMessage,
  type MessagesMap,
  type UseSendMessageProps,
  type UseSendMessageReturn,
} from '../types';
import { streamOracleResponse } from './stream-oracle-response';
import { updateMessagesMap } from './update-messages-map';

export const getMessagesQueryKey = ({ sessionId }: { sessionId: string }) =>
  ['messages', sessionId] as const;

type AIResponsePayload = {
  message: string;
  requestId: string;
};

type MutationContext = {
  previousValue: MessagesMap | undefined;
};

export function useSendMessage({
  sessionId,
}: UseSendMessageProps): UseSendMessageReturn {
  const queryClient = useQueryClient();
  const {
    connectionId,
    apiKey,
    apiUrl,
    config: { did, matrixAccessToken },
  } = useOraclesContext();
  const [, forceUpdate] = useState<IMessage | null>(null);

  const messagesQueryKey = getMessagesQueryKey({ sessionId });
  const sessionsQueryKey = getSessionsQueryKey({ did });

  const addAIResponse = useCallback(
    async ({ message, requestId }: AIResponsePayload) => {
      if (!requestId) throw new Error('Request ID is required');

      queryClient.setQueryData(messagesQueryKey, updateMessagesMap);
      forceUpdate({
        content: message,
        id: requestId,
        type: 'ai',
      });
    },
    [queryClient, messagesQueryKey],
  );

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: async (message: string) => {
      validateRequiredFields({ connectionId, sessionId });

      await queryClient.cancelQueries({ queryKey: messagesQueryKey });

      await streamOracleResponse({
        apiKey,
        apiURL: apiUrl,
        did,
        message,
        connectionId,
        matrixAccessToken,
        sessionId,
        cb: addAIResponse,
      });
    },

    async onMutate(message: string): Promise<MutationContext> {
      validateRequiredFields({ connectionId, sessionId });

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: messagesQueryKey });

      // Snapshot the previous value
      const previousValue =
        queryClient.getQueryData<MessagesMap>(messagesQueryKey);

      // Create new message
      const messagePayload: IMessage = {
        id: window.crypto.randomUUID(),
        content: message,
        type: 'human',
      };

      // Optimistically update messages
      queryClient.setQueryData<MessagesMap>(
        messagesQueryKey,
        (old = {}): MessagesMap => ({
          ...old,
          [messagePayload.id]: messagePayload,
        }),
      );

      return { previousValue };
    },

    onError(_, __, context: MutationContext | undefined) {
      // Rollback to previous state on error
      if (context?.previousValue) {
        queryClient.setQueryData(messagesQueryKey, context.previousValue);
      }
    },

    async onSettled() {
      // Invalidate related queries to refetch latest data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey }),
      ]);
    },
  });

  return {
    sendMessage: mutateAsync,
    isSending: isPending,
    error,
  };
}

const validateRequiredFields = ({
  connectionId,
  sessionId,
}: {
  connectionId?: string;
  sessionId?: string;
}): void => {
  if (!connectionId) throw new Error('Connection ID is required');
  if (!sessionId) throw new Error('Session ID is required');
};
