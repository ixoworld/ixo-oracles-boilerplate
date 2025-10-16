'use client';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { useOraclesContext } from '../../../providers/oracles-provider/oracles-context.js';
import { RequestError } from '../../../utils/request.js';
import {
  parseSSEStream,
  type SSEErrorEventData,
  type SSEReasoningEventData,
  type SSEToolCallEventData,
} from '../../../utils/sse-parser.js';
import { useGetOpenIdToken } from '../../use-get-openid-token/use-get-openid-token.js';
import { useOraclesConfig } from '../../use-oracles-config.js';
import { type IMessage, type ISendMessageOptions } from './types.js';

interface IUseSendMessageReturn {
  sendMessage: (
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  abortStream: () => void;
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
  refetchQueries,
  onToolCall,
  onError,
  onReasoning,
}: ISendMessageOptions): IUseSendMessageReturn {
  const { config } = useOraclesConfig(oracleDid);
  const { apiUrl: baseUrl } = config;
  const { baseUrl: overridesUrl } = overrides ?? {};
  const apiUrl = overridesUrl ?? baseUrl;
  const { wallet, authedRequest } = useOraclesContext();
  const {
    openIdToken,
    isLoading: isTokenLoading,
    error: tokenError,
  } = useGetOpenIdToken();

  // Abort controller for canceling requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort function to cancel ongoing stream
  const abortStream = useCallback(async () => {
    if (abortControllerRef.current) {
      // Call backend abort endpoint with sessionId
      try {
        await authedRequest(`${apiUrl}/messages/abort`, 'POST', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      } catch (err) {
        console.error('Failed to abort on backend:', err);
      }

      // Also abort locally for immediate UI feedback
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      chatRef?.current.setStatus('ready');
    }
  }, [apiUrl, sessionId, chatRef]);

  const { mutateAsync, isPending, error } = useMutation({
    retry: false, // Prevent retries on abort/errors
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
      if (isTokenLoading) {
        throw new Error(
          'OpenID token is still loading. Please wait for authentication to complete.',
        );
      }
      if (tokenError) {
        throw new Error(`OpenID token fetch failed: ${tokenError.message}`);
      }
      if (!openIdToken?.access_token) {
        throw new Error('Matrix access token is required');
      }

      // Set status to streaming
      chatRef?.current.setStatus('submitted');

      try {
        // 1. Add optimistic user message immediately
        const userMessage: IMessage = {
          id: window.crypto.randomUUID(),
          content: message,
          type: 'human',
        };
        await chatRef?.current.addUserMessage(userMessage);

        // 2. Stream AI response
        chatRef?.current.setStatus('streaming');

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        const results = await askOracleStream({
          apiURL: apiUrl,
          did: wallet.did,
          message,
          matrixAccessToken: openIdToken.access_token,
          sessionId,
          metadata,
          browserTools: browserTools
            ? Object.values(browserTools).map((tool) => ({
                name: tool.toolName,
                description: tool.description,
                schema: zodToJsonSchema(tool.schema),
              }))
            : undefined,
          abortSignal: abortControllerRef.current?.signal,

          // Message chunks (existing pattern)
          onMessage: async ({ chunk, requestId }) => {
            await chatRef?.current.upsertAIMessage(requestId, chunk);
          },

          // Tool calls (NEW - forward to useChat callback)
          onToolCall: onToolCall
            ? async ({ toolCallData }) => {
                await onToolCall(toolCallData);
              }
            : undefined,

          // Errors (NEW - forward to useChat callback)
          onError: onError
            ? async ({ error }) => {
                await onError(error);
              }
            : undefined,

          // Reasoning (NEW - forward to useChat callback)
          onReasoning: onReasoning
            ? async ({ reasoningData, requestId }) => {
                await onReasoning({ reasoningData, requestId });
              }
            : undefined,

          onDone: () => {
            chatRef?.current.setStatus('ready');
            abortControllerRef.current = null;
          },
        });

        chatRef?.current.setStatus('ready');

        return { requestId: results.requestId };
      } catch (err) {
        // Clear abort controller on error
        abortControllerRef.current = null;

        // Handle abort errors gracefully - user intentionally cancelled
        if (
          err instanceof Error &&
          (err.name === 'AbortError' ||
            (err instanceof DOMException && err.name === 'AbortError'))
        ) {
          chatRef?.current.setStatus('ready');
          return;
        }

        if (RequestError.isRequestError(err) && err.claims) {
          onPaymentRequiredError(err.claims as string[]);
          chatRef?.current.setStatus('ready');
          return;
        }
        chatRef?.current.setStatus(
          'error',
          err instanceof Error ? err : new Error('Unknown error'),
        );
        throw err;
      } finally {
        // Clear abort controller when done
        abortControllerRef.current = null;

        // Refetch queries regardless of success/error/early return
        if (refetchQueries) {
          await refetchQueries();
        }
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
    abortStream,
    isSending: isPending,
    error,
  };
}

// Stream AI responses from the oracle
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
  abortSignal?: AbortSignal;

  // Callbacks for different event types
  onMessage: (args: {
    chunk: string;
    requestId: string;
  }) => void | Promise<void>;
  onToolCall?: (args: {
    toolCallData: SSEToolCallEventData;
    requestId: string;
  }) => void | Promise<void>;
  onError?: (args: {
    error: SSEErrorEventData;
    requestId: string;
  }) => void | Promise<void>;
  onReasoning?: (args: {
    reasoningData: SSEReasoningEventData;
    requestId: string;
  }) => void | Promise<void>;
  onDone?: () => void;
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
  let accumulatedText = '';

  try {
    // Parse SSE events from the stream
    for await (const sseEvent of parseSSEStream(reader)) {
      // Type-safe event handling using discriminated unions
      switch (sseEvent.event) {
        case 'message':
          await props.onMessage({ chunk: sseEvent.data.content, requestId });
          accumulatedText += sseEvent.data.content;
          break;

        case 'tool_call':
          if (props.onToolCall) {
            await props.onToolCall({ toolCallData: sseEvent.data, requestId });
          }
          break;

        case 'error':
          if (props.onError) {
            await props.onError({ error: sseEvent.data, requestId });
          }
          break;

        case 'done':
          props.onDone?.();
          break;

        case 'router.update':
          // Ignore for now - future enhancement
          break;

        case 'render_component':
          // Ignore for now - future enhancement
          break;

        case 'browser_tool_call':
          // Ignore for now - future enhancement
          break;

        case 'message_cache_invalidation':
          // Ignore for now - future enhancement
          break;

        case 'reasoning':
          if (props.onReasoning) {
            await props.onReasoning({
              reasoningData: sseEvent.data,
              requestId,
            });
          }
          break;

        default:
          // This should never happen with proper typing, but handle gracefully
          console.debug('Unknown SSE event:', (sseEvent as any).event);
          break;
      }
    }

    return {
      text: accumulatedText,
      requestId,
    };
  } catch (error) {
    reader.cancel();

    // Handle abort errors gracefully
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        (error instanceof DOMException && error.name === 'AbortError'))
    ) {
      // Don't throw abort errors - they're expected when user cancels
      return {
        text: accumulatedText,
        requestId,
      };
    }

    throw error;
  }
};
