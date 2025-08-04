import type {
  AllEvents,
  EventNames,
  WithRequiredEventProps,
} from '@ixo/oracles-events/types';
import { type ErrorEvent, EventSource } from 'eventsource';
import { useEffect, useState } from 'react';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useOraclesConfig } from '../use-oracles-config.js';

export const evNames = {
  ToolCall: 'tool_call',
  RenderComponent: 'render_component',
  MessageCacheInvalidation: 'message_cache_invalidation',
  RouterUpdate: 'router_update',
} satisfies Partial<EventNames>;

export type Event<T = Record<string, any>> = {
  eventName: string;
  payload: WithRequiredEventProps<T>;
};

export const useLiveEvents = (props: {
  oracleDid: string;
  sessionId: string;
  handleInvalidateCache: () => void;
  handleNewEvent: (event: Event) => void;
  overrides?: {
    baseUrl?: string;
  };
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<ErrorEvent | null>(null);
  const { config } = useOraclesConfig(props.oracleDid);
  const apiUrl = props.overrides?.baseUrl ?? config.apiUrl ?? '';
  const { wallet } = useOraclesContext();

  useEffect(() => {
    if (
      !wallet ||
      !props.sessionId ||
      !apiUrl ||
      !wallet.did ||
      !wallet.matrix.accessToken
    ) {
      return;
    }
    const eventSource = new EventSource(
      `${apiUrl}/sse/events?sessionId=${props.sessionId}`,
      {
        fetch: (url, init) => {
          return fetch(url, {
            ...init,
            headers: {
              ...init?.headers,
              'x-matrix-access-token': wallet.matrix.accessToken,
              'x-did': wallet.did,
            },
          });
        },
      },
    );
    eventSource.onopen = () => {
      setIsConnected(true);
    };
    eventSource.onerror = (error) => {
      setIsConnected(false);
      setError(error);
      console.error(error);
    };

    // event listener for events
    const handleEvent = (event: MessageEvent<AllEvents>) => {
      const ev = (
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      ) as Event;
      if (ev.eventName === evNames.MessageCacheInvalidation) {
        props.handleInvalidateCache();
      } else {
        props.handleNewEvent(ev); // Forward immediately
      }
    };

    eventSource.addEventListener('message', handleEvent);

    return () => {
      eventSource.close();
      eventSource.removeEventListener('message', handleEvent);
    };
  }, [apiUrl, props.oracleDid, props.sessionId, wallet]);

  return { isConnected, error };
};
