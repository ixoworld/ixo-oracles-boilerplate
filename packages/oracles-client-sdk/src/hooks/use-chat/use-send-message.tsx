'use client';
import {
  useMutation,
  useQueryClient,
  type UseMutateAsyncFunction,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { type IBrowserTools } from '../../types/browser-tool.type.js';
import { RequestError } from '../../utils/request.js';
import { useOraclesConfig } from '../use-oracles-config.js';
import {
  type IMessage,
  type MessagesMap,
} from './transform-to-messages-map.js';

interface IUseSendMessageReturn {
  sendMessage: UseMutateAsyncFunction<
    void,
    Error,
    { message: string; sId: string; metadata?: Record<string, unknown> },
    {
      previousValue: unknown;
    }
  >;
  isSending: boolean;
  error?: Error | null;
}

export function useSendMessage({
  oracleDid,
  sessionId,
  overrides,
  onPaymentRequiredError,
  browserTools,
}: {
  oracleDid: string;
  sessionId: string;
  overrides?: {
    baseUrl?: string;
  };
  onPaymentRequiredError: (claimIds: string[]) => void;
  browserTools?: IBrowserTools;
}): IUseSendMessageReturn {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController>();
  const [_, forceUpdate] = useState(0);
  const { config } = useOraclesConfig(oracleDid);
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;
  const { wallet } = useOraclesContext();

  // Cleanup effect for aborting ongoing requests when unmounting
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const addAIResponse = useCallback(
    async ({ message, requestId }: { message: string; requestId: string }) => {
      queryClient.setQueryData(
        [oracleDid, 'messages', sessionId],
        (old: MessagesMap = {}): MessagesMap => {
          // Get existing message or create new one
          const existingMessage = old[requestId] || {
            id: requestId,
            content: '',
            type: 'ai',
          };

          // Append new chunk to existing content
          const updatedMessage: IMessage = {
            ...existingMessage,
            content:
              typeof existingMessage.content === 'string' ? (
                existingMessage.content + message
              ) : (
                <>
                  {existingMessage.content}\n
                  {message}
                </>
              ),
          };
          return {
            ...old,
            [updatedMessage.id]: updatedMessage,
          };
        },
      );
    },
    [queryClient, sessionId],
  );

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: async ({
      message,
      sId,
      metadata,
    }: {
      message: string;
      sId: string;
      metadata?: Record<string, unknown>;
    }) => {
      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();

      await queryClient.cancelQueries({
        queryKey: [oracleDid, 'messages', sId],
      });
      if (!apiUrl) {
        throw new Error('API URL is required');
      }
      if (!wallet?.did) {
        throw new Error('DID is required');
      }
      if (!wallet.matrix.accessToken) {
        throw new Error('Matrix access token is required');
      }
      try {
        await askOracleStream({
          apiURL: apiUrl,
          did: wallet.did,
          message,
          matrixAccessToken: wallet.matrix.accessToken,
          sessionId: sId,
          metadata,
          cb: addAIResponse,
          abortSignal: abortControllerRef.current.signal,
          browserTools: Object.values(browserTools ?? {}).map((tool) => ({
            name: tool.toolName,
            description: tool.description,
            schema: zodToJsonSchema(tool.schema),
          })),
        });
      } catch (err) {
        if (RequestError.isRequestError(err) && err.claims) {
          onPaymentRequiredError(err.claims as string[]);
          return;
        }
        throw err;
      }
    },

    async onMutate({ message, sId }: { message: string; sId: string }) {
      if (!sId) {
        throw new Error('Session ID is required');
      }
      await queryClient.cancelQueries({
        queryKey: [oracleDid, 'messages', sId],
      });
      const previousValue = queryClient.getQueryData<MessagesMap>([
        oracleDid,
        'messages',
        sId,
      ]);
      const messagePayload: IMessage = {
        id: window.crypto.randomUUID(),
        content: message,
        type: 'human',
      };
      queryClient.setQueryData(
        [oracleDid, 'messages', sId],
        (old: MessagesMap = {}): MessagesMap => {
          return {
            ...old,
            [messagePayload.id]: messagePayload,
          };
        },
      );
      return { previousValue };
    },
    onError(_, __, context) {
      queryClient.setQueryData(
        [oracleDid, 'messages', sessionId],
        context?.previousValue,
      );
    },
    async onSettled() {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [oracleDid, 'messages', sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['oracle-sessions', oracleDid],
        }),
      ]);
    },
  });
  return {
    sendMessage: mutateAsync,
    isSending: isPending,
    error,
  };
}

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
  abortSignal: AbortSignal;
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
      metadata: props.metadata,
      tools: props.browserTools,
    }),
    method: 'POST',
    signal: props.abortSignal,
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
