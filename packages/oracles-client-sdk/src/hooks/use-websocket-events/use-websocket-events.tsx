import { type AllEvents } from '@ixo/oracles-events/types';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useOraclesConfig } from '../use-oracles-config.js';
import {
  type ConnectionStatus,
  type IUseWebSocketEventsReturn,
  type IWebSocketConfig,
  type WebSocketEvent,
} from './types.js';

export function useWebSocketEvents(
  props: IWebSocketConfig,
): IUseWebSocketEventsReturn {
  const { config, isReady: isConfigReady } = useOraclesConfig(
    props.oracleDid,
    props.overrides,
  );
  const { wallet } = useOraclesContext();

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const [lastActivity, setLastActivity] = useState<string | null>(null);

  // Use ref to store socket to prevent reconnections on re-renders
  const socketRef = useRef<Socket | null>(null);
  // Use ref to store callback to prevent dependency issues
  const handleInvalidateCacheRef = useRef(props.handleInvalidateCache);

  // Update the callback ref when it changes
  handleInvalidateCacheRef.current = props.handleInvalidateCache;

  const { sessionId, overrides } = props;
  const getApiUrl = () =>
    overrides?.wsUrl ?? config.socketUrl ?? overrides?.baseUrl;

  useEffect(() => {
    const apiUrl = getApiUrl();
    if (!wallet || !sessionId || !apiUrl) {
      return;
    }

    // Don't create new connection if one already exists for the same session
    if (socketRef.current?.connected) {
      return;
    }

    setConnectionStatus('connecting');
    setError(null);

    // Create WebSocket connection
    const newSocket = io(apiUrl, {
      query: { sessionId },
      transports: ['websocket'],
    });

    socketRef.current = newSocket;

    // Connection event handlers
    newSocket.on('connect', () => {
      setIsConnected(true);
      setConnectionStatus('connected');
      setLastActivity(new Date().toISOString());
      setError(null);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      setConnectionStatus('disconnected');
      setLastActivity(new Date().toISOString());
    });

    newSocket.on('connect_error', (err) => {
      setIsConnected(false);
      setConnectionStatus('error');
      setError(err);
      setLastActivity(new Date().toISOString());
    });

    const handleEvent = (event: AllEvents) => {
      props.handleNewEvent?.(event);
    };

    newSocket.on(evNames.ToolCall, handleEvent);
    newSocket.on(evNames.RenderComponent, handleEvent);
    newSocket.on(
      evNames.MessageCacheInvalidation,
      handleInvalidateCacheRef.current ?? (() => {}),
    );

    if (props.browserTools && Object.keys(props.browserTools).length > 0) {
      // Listen for browser tool calls
      newSocket.on(
        'browser_tool_call',
        async (data: { toolCallId: string; toolName: string; args: any }) => {
          try {
            const tool = props.browserTools?.[data.toolName];
            if (!tool) {
              throw new Error(`Tool ${data.toolName} not found`);
            }
            const result = await tool.fn(data.args);
            newSocket.emit('tool_result', {
              toolCallId: data.toolCallId,
              result,
            });
          } catch (error) {
            newSocket.emit('tool_result', {
              toolCallId: data.toolCallId,
              result: null,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        },
      );
    }

    // Listen for all events from the server
    newSocket.onAny((_, ev: unknown) => {
      const event = isWebSocketEvent(ev) ? ev : null;
      if (!event) {
        return;
      }
      // Skip browser_tool_call events as they're handled above
      if (event.eventName === 'browser_tool_call') {
        return;
      }

      props.handleNewEvent?.(event);
      setLastActivity(new Date().toISOString());

      // Handle cache invalidation using ref
      if (
        event.eventName === 'message_cache_invalidation' &&
        handleInvalidateCacheRef.current
      ) {
        handleInvalidateCacheRef.current();
      }
    });

    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setConnectionStatus('disconnected');
    };
  }, [sessionId, wallet, overrides, config.socketUrl]); // Removed handleInvalidateCache from dependencies

  return {
    isConnected,
    error,
    connectionStatus,
    lastActivity,
    isConfigReady,
  };
}

// Export event names for convenience (same as SSE version)
export const evNames = {
  ToolCall: 'tool_call',
  RenderComponent: 'render_component',
  MessageCacheInvalidation: 'message_cache_invalidation',
  RouterUpdate: 'router_update',
  BrowserToolCall: 'browser_tool_call',
} as const;

const isWebSocketEvent = (event: unknown): event is WebSocketEvent => {
  return (
    typeof event === 'object' &&
    event !== null &&
    'eventName' in event &&
    'payload' in event &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    'sessionId' in event.payload &&
    'requestId' in event.payload
  );
};
