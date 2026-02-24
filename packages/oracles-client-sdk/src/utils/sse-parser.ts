/* eslint-disable no-console */
/**
 * SSE (Server-Sent Events) stream parser for handling real-time events
 * from the backend streaming API.
 */

// Base SSE event structure
export interface BaseSSEEvent<TEvent extends string, TData> {
  event: TEvent;
  data: TData;
}

// Individual event data types
export interface SSEMessageEventData {
  content: string;
  timestamp: string;
}

export interface SSEToolCallEventData {
  sessionId: string;
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'isRunning' | 'done';
  output?: string;
  eventId?: string;
}

export interface SSEErrorEventData {
  error: string;
  timestamp: string;
}

export interface SSEDoneEventData {
  timestamp?: string;
}

export interface SSERouterUpdateEventData {
  step: string;
  sessionId: string;
  requestId: string;
  eventId?: string;
}

export interface SSERenderComponentEventData {
  componentName: string;
  args?: Record<string, unknown>;
  status?: 'isRunning' | 'done';
  sessionId: string;
  requestId: string;
  eventId?: string;
}

export interface SSEBrowserToolCallEventData {
  toolName: string;
  args?: Record<string, unknown>;
  status?: 'isRunning' | 'done';
  sessionId: string;
  requestId: string;
  eventId?: string;
}

/**
 * SSE event data for AG-UI action calls
 * @remarks
 * Args are NOT included in SSE events to avoid data duplication.
 * Args are sent once via WebSocket where the handler executes and render is called.
 * SSE events provide status updates only for the chat UI timeline.
 */
export interface SSEActionCallEventData {
  sessionId: string;
  requestId: string;
  toolName: string;
  /** Args excluded from SSE events (sent via WebSocket only) */
  args?: Record<string, unknown>;
  status?: 'isRunning' | 'done' | 'error';
  output?: string;
  toolCallId?: string;
  error?: string;
}

export interface SSEMessageCacheInvalidationEventData {
  status?: 'isRunning' | 'done';
  sessionId: string;
  requestId: string;
  eventId?: string;
}

export interface SSEReasoningEventData {
  sessionId: string;
  requestId: string;
  reasoning: string;
  reasoningDetails?: Array<{
    type: string;
    text: string;
    format: string;
    index: number;
  }>;
  isComplete?: boolean;
  timestamp?: string;
  eventId?: string;
}

// Type-safe SSE events using discriminated unions
export type SSEEvent =
  | BaseSSEEvent<'message', SSEMessageEventData>
  | BaseSSEEvent<'tool_call', SSEToolCallEventData>
  | BaseSSEEvent<'action_call', SSEActionCallEventData>
  | BaseSSEEvent<'error', SSEErrorEventData>
  | BaseSSEEvent<'done', SSEDoneEventData>
  | BaseSSEEvent<'router.update', SSERouterUpdateEventData>
  | BaseSSEEvent<'render_component', SSERenderComponentEventData>
  | BaseSSEEvent<'browser_tool_call', SSEBrowserToolCallEventData>
  | BaseSSEEvent<
      'message_cache_invalidation',
      SSEMessageCacheInvalidationEventData
    >
  | BaseSSEEvent<'reasoning', SSEReasoningEventData>;

// Legacy type aliases for backward compatibility
export type SSEToolCallPayload = SSEToolCallEventData;
export type SSEErrorEvent = SSEErrorEventData;
export type SSEMessageEvent = SSEMessageEventData;

// Helper function to validate SSE event types
function isValidSSEEventType(
  eventType: string,
): eventType is SSEEvent['event'] {
  const validEventTypes: SSEEvent['event'][] = [
    'message',
    'tool_call',
    'action_call',
    'error',
    'done',
    'router.update',
    'render_component',
    'browser_tool_call',
    'message_cache_invalidation',
    'reasoning',
  ];
  return validEventTypes.includes(eventType as SSEEvent['event']);
}

/**
 * Parse SSE stream from ReadableStream reader
 * Handles buffer management, event/data parsing, and JSON deserialization
 *
 * @param reader - ReadableStreamDefaultReader for the SSE stream
 * @returns AsyncGenerator yielding parsed SSE events
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        // Handle abort errors gracefully - this is expected when user cancels
        if (
          readError instanceof Error &&
          (readError.name === 'AbortError' ||
            (readError instanceof DOMException &&
              readError.name === 'AbortError'))
        ) {
          // Stream was intentionally aborted, exit gracefully
          break;
        }
        // Re-throw other errors
        throw readError;
      }

      const { done, value } = readResult;
      if (done) break;

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep last incomplete line in buffer
      buffer = lines.pop() || '';

      let event = '';
      let data = '';

      // Process complete lines
      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines and comments
        if (trimmedLine === '' || trimmedLine.startsWith(':')) {
          // Empty line = event complete
          if (event && data) {
            try {
              const parsedData = JSON.parse(data);
              // Type-safe event creation with fallback for unknown events
              if (isValidSSEEventType(event)) {
                yield { event, data: parsedData };
              } else {
                continue;
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', data, parseError);
            }
            event = '';
            data = '';
          }
          continue;
        }

        if (trimmedLine.startsWith('event:')) {
          event = trimmedLine.slice(6).trim();
        } else if (trimmedLine.startsWith('data:')) {
          data = trimmedLine.slice(5).trim();
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let event = '';
      let data = '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('event:')) {
          event = trimmedLine.slice(6).trim();
        } else if (trimmedLine.startsWith('data:')) {
          data = trimmedLine.slice(5).trim();
        }
      }

      if (event && data) {
        try {
          const parsedData = JSON.parse(data);
          // Type-safe event creation with fallback for unknown events
          if (isValidSSEEventType(event)) {
            yield { event, data: parsedData };
          }
        } catch (parseError) {
          console.warn('Failed to parse final SSE data:', data, parseError);
        }
      }
    }
  } catch (error) {
    // Handle abort errors gracefully - expected when stream is cancelled
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        (error instanceof DOMException && error.name === 'AbortError'))
    ) {
      // Stream was aborted, exit gracefully without throwing
      return;
    }
    console.error('Error parsing SSE stream:', error);
    throw error;
  }
}
