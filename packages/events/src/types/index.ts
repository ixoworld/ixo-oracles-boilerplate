import { type WithRequiredEventProps } from '../events/base-event/base-event';
import { BrowserToolCallEvent } from '../events/browser-tool-call/browser-tool-call.event';
import { MessageCacheInvalidationEvent } from '../events/message-cache-invalidation';
import { RenderComponentEvent } from '../events/render-component/render-component.event';
import { RouterEvent } from '../events/router-event/router.event';
import { ToolCallEvent } from '../events/tool-call/tool-call.event';

// Import interfaces to avoid circular references
import { type IBrowserToolCallEvent } from '../events/browser-tool-call/types';
import { type IToolCallEvent } from '../events/tool-call/types';

export type AllEvents =
  | RouterEvent
  | ToolCallEvent
  | RenderComponentEvent
  | MessageCacheInvalidationEvent
  | BrowserToolCallEvent;
export const AllEventsAsClass = [
  RouterEvent,
  ToolCallEvent,
  RenderComponentEvent,
  MessageCacheInvalidationEvent,
  BrowserToolCallEvent,
];

// Fix circular references by using actual interfaces
export type ToolCallEventPayload = WithRequiredEventProps<IToolCallEvent>;
export type RouterEventPayload = WithRequiredEventProps<{ step: string }>;
export type RenderComponentEventPayload = WithRequiredEventProps<{
  componentName: string;
  args?: Record<string, unknown>;
  status?: 'isRunning' | 'done';
  eventId?: string;
}>;
export type MessageCacheInvalidationEventPayload = WithRequiredEventProps<{
  status?: 'isRunning' | 'done';
}>;
export type BrowserToolCallEventPayload =
  WithRequiredEventProps<IBrowserToolCallEvent>;

export type EventNames = {
  ToolCall: ToolCallEvent['eventName'];
  RouterUpdate: RouterEvent['eventName'];
  RenderComponent: RenderComponentEvent['eventName'];
  MessageCacheInvalidation: MessageCacheInvalidationEvent['eventName'];
  BrowserToolCall: BrowserToolCallEvent['eventName'];
};

export type { WithRequiredEventProps } from '../events/base-event/base-event';

// Export interfaces for external consumers
export type { IBrowserToolCallEvent } from '../events/browser-tool-call/types';
export type { IToolCallEvent } from '../events/tool-call/types';
