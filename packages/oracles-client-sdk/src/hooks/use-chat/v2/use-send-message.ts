'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { useOraclesContext } from '../../../providers/oracles-provider/oracles-context.js';
import { RequestError } from '../../../utils/request.js';
import { useOraclesConfig } from '../../use-oracles-config.js';
import { type IMessage, type ISendMessageOptions } from './types.js';
import { asyncDebounce } from './utils.js';

interface IUseSendMessageReturn {
  sendMessage: (
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  isSending: boolean;
  error?: Error | null;
}

export function useSendMessage({
  oracleDid,
  sessionId,
  overrides,
  onPaymentRequiredError,
  browserTools,
  chatRef,
}: ISendMessageOptions): IUseSendMessageReturn {
  const queryClient = useQueryClient();
  const { config } = useOraclesConfig(oracleDid);
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;
  const { wallet } = useOraclesContext();

  // Streaming callback for AI responses
  const addAIResponse = asyncDebounce(
    useCallback(
      async ({
        message,
        requestId,
      }: {
        message: string;
        requestId: string;
      }) => {
        // Use the optimized chat API
        console.log('addAIResponse', requestId, message);
        await chatRef.current.upsertAIMessage(requestId, message);
      },
      [chatRef],
    ),
    50,
  );

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: async ({
      message,
      metadata,
    }: {
      message: string;
      metadata?: Record<string, unknown>;
    }) => {
      if (!apiUrl) {
        throw new Error('API URL is required');
      }
      if (!wallet?.did) {
        throw new Error('DID is required');
      }
      if (!wallet.matrix.accessToken) {
        throw new Error('Matrix access token is required');
      }

      // Set status to streaming
      chatRef.current.setStatus('submitted');

      try {
        // 1. Add optimistic user message immediately
        const userMessage: IMessage = {
          id: window.crypto.randomUUID(),
          content: message,
          type: 'human',
        };
        await chatRef.current.addUserMessage(userMessage);

        // 2. Stream AI response
        chatRef.current.setStatus('streaming');

        const { requestId } = await askOracleStream({
          apiURL: apiUrl,
          did: wallet.did,
          message,
          matrixAccessToken: wallet.matrix.accessToken,
          sessionId,
          metadata,
          cb: addAIResponse,
          browserTools: browserTools
            ? Object.values(browserTools).map((tool) => ({
                name: tool.toolName,
                description: tool.description,
                schema: zodToJsonSchema(tool.schema),
              }))
            : undefined,
        });

        chatRef.current.setStatus('ready');

        return { requestId };
      } catch (err) {
        if (RequestError.isRequestError(err) && err.claims) {
          onPaymentRequiredError(err.claims as string[]);
          chatRef.current.setStatus('ready');
          return;
        }
        chatRef.current.setStatus(
          'error',
          err instanceof Error ? err : new Error('Unknown error'),
        );
        throw err;
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: [oracleDid, 'messages', sessionId],
            refetchType: 'all',
          }),
          queryClient.invalidateQueries({
            queryKey: ['oracle-sessions', oracleDid],
            refetchType: 'all',
          }),
        ]);
      }
    },
  });

  const sendMessage = useCallback(
    async (message: string, metadata?: Record<string, unknown>) => {
      await mutateAsync({ message, metadata });
    },
    [mutateAsync],
  );

  return {
    sendMessage,
    isSending: isPending,
    error,
  };
}

// Keep your existing askOracleStream function
const askOracleStream = async (props: {
  apiURL: string;
  did: string;
  message: string;
  sessionId: string;
  matrixAccessToken: string;
  metadata?: Record<string, unknown>;
  browserTools?: {
    name: string;
    description: string;
    schema: Record<string, unknown>;
  }[];
  cb: ({
    requestId,
    message,
  }: {
    requestId: string;
    message: string;
  }) => Promise<void>;
}): Promise<{ text: string; requestId: string }> => {
  const response = await fetch(`${props.apiURL}/messages/${props.sessionId}`, {
    headers: {
      'x-matrix-access-token': props.matrixAccessToken,
      'Content-Type': 'application/json',
      'x-did': props.did,
    },
    body: JSON.stringify({
      message: props.message,
      stream: true,
      ...(props.metadata && { metadata: props.metadata }),
      ...(props.browserTools && { tools: props.browserTools }),
    }),
    method: 'POST',
  });

  if (!response.ok) {
    const err = (await response.json()) as { message: string };
    throw new RequestError(err.message, err);
  }

  const requestId = response.headers.get('X-Request-Id');
  if (!requestId) {
    throw new Error('Did not receive a request ID');
  }

  // Check if ReadableStream is supported
  if (!response.body) {
    throw new Error('ReadableStream not supported in this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulatedText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode this chunk
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        // Call callback with just this chunk, not the accumulated text
        await props.cb({ requestId, message: chunk });

        // Also accumulate for the final return value
        accumulatedText += chunk;
      }
    }

    // Final decoder flush
    const final = decoder.decode();
    if (final.length > 0) {
      await props.cb({ requestId, message: final });
      accumulatedText += final;
    }

    return {
      text: accumulatedText,
      requestId,
    };
  } catch (error) {
    reader.cancel();
    throw error;
  }
};
