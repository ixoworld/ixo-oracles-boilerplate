import { MessageCacheInvalidationEvent } from '../events/message-cache-invalidation';
import { RenderComponentEvent } from '../events/render-component/render-component.event';
import { RouterEvent } from '../events/router-event/router.event';
import { ToolCallEvent } from '../events/tool-call/tool-call.event';

export type AllEvents =
  | RouterEvent
  | ToolCallEvent
  | RenderComponentEvent
  | MessageCacheInvalidationEvent;
export const AllEventsAsClass = [
  RouterEvent,
  ToolCallEvent,
  RenderComponentEvent,
  MessageCacheInvalidationEvent,
];

export type ToolCallEventPayload = ToolCallEvent['payload'];
export type RouterEventPayload = RouterEvent['payload'];
export type RenderComponentEventPayload = RenderComponentEvent['payload'];
export type MessageCacheInvalidationEventPayload =
  MessageCacheInvalidationEvent['payload'];

export type EventNames = {
  ToolCall: ToolCallEvent['eventName'];
  RouterUpdate: RouterEvent['eventName'];
  RenderComponent: RenderComponentEvent['eventName'];
  MessageCacheInvalidation: MessageCacheInvalidationEvent['eventName'];
};

export type { WithRequiredEventProps } from '../events/base-event/base-event';
