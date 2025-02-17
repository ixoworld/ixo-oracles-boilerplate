import {
  type RenderComponentEventPayload,
  type RouterEventPayload,
  type ToolCallEventPayload,
  type WithRequiredEventProps,
} from '@ixo/oracles-events/types';
import { useCallback, useState } from 'react';
import { useSocketEvent } from 'socket.io-react-hook';
import { useOraclesContext } from '../oracles-provider';

export type Event<T = Record<string, any>> = {
  eventName: string;
  payload: WithRequiredEventProps<T>;
};

interface ILiveEventsHookProps {
  /**
   * revalidate the cache
   *
   * @returns void
   */
  revalidate: () => Promise<unknown>;
}

interface ILiveEventsHookReturn {
  events: Event[];
  getLatestEvent: () => Event | null;
}

export default function useLiveEvents({
  revalidate,
}: ILiveEventsHookProps): ILiveEventsHookReturn {
  const { socket } = useOraclesContext();

  const [events, setEvents] = useState<Event[]>([]);

  const onRouterUpdate = useCallback((payload: RouterEventPayload) => {
    setEvents((prev) => [...prev, { eventName: 'router.update', payload }]);
  }, []);

  const onToolCall = useCallback((event: ToolCallEventPayload) => {
    setEvents((prev) => [...prev, { eventName: 'tool_call', payload: event }]);
  }, []);

  const onRenderComponent = useCallback(
    (event: RenderComponentEventPayload) => {
      setEvents((prev) => [
        ...prev,
        { eventName: 'render_component', payload: event },
      ]);
    },
    [],
  );

  const onMessageCacheInvalidation = useCallback(() => {
    revalidate().catch(console.error);
  }, [revalidate]);

  useSocketEvent(socket, 'router.update', {
    onMessage: onRouterUpdate,
  });
  useSocketEvent(socket, 'tool_call', {
    onMessage: onToolCall,
  });
  useSocketEvent(socket, 'render_component', {
    onMessage: onRenderComponent,
  });
  useSocketEvent(socket, 'message_cache_invalidation', {
    onMessage: onMessageCacheInvalidation,
  });

  const getLatestEvent = useCallback(() => {
    const ev = events.at(-1);
    if (!ev) return null;
    setEvents((prev) => prev.slice(0, -1));
    return ev;
  }, [events]);

  return { events, getLatestEvent };
}
