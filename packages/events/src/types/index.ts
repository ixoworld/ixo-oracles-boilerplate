import { type WithRequiredEventProps } from '../events/base-event/base-event';
import { BrowserToolCallEvent } from '../events/browser-tool-call/browser-tool-call.event';
import { MessageCacheInvalidationEvent } from '../events/message-cache-invalidation';
import { ReasoningEvent } from '../events/reasoning-event';
import { RenderComponentEvent } from '../events/render-component/render-component.event';
import { RouterEvent } from '../events/router-event/router.event';
import { ToolCallEvent } from '../events/tool-call/tool-call.event';

// Import interfaces to avoid circular references
import { type IBrowserToolCallEvent } from '../events/browser-tool-call/types';
import { type IReasoningEvent } from '../events/reasoning-event/types';
import { type IToolCallEvent } from '../events/tool-call/types';

export type AllEvents =
  | RouterEvent
  | ToolCallEvent
  | RenderComponentEvent
  | MessageCacheInvalidationEvent
  | BrowserToolCallEvent
  | ReasoningEvent;
export const AllEventsAsClass = [
  RouterEvent,
  ToolCallEvent,
  RenderComponentEvent,
  MessageCacheInvalidationEvent,
  BrowserToolCallEvent,
  ReasoningEvent,
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
export type ReasoningEventPayload = WithRequiredEventProps<IReasoningEvent>;

export type EventNames = {
  ToolCall: ToolCallEvent['eventName'];
  RouterUpdate: RouterEvent['eventName'];
  RenderComponent: RenderComponentEvent['eventName'];
  MessageCacheInvalidation: MessageCacheInvalidationEvent['eventName'];
  BrowserToolCall: BrowserToolCallEvent['eventName'];
  Reasoning: ReasoningEvent['eventName'];
};

export type { WithRequiredEventProps } from '../events/base-event/base-event';

// Export interfaces for external consumers
export type { IBrowserToolCallEvent } from '../events/browser-tool-call/types';
export type { IReasoningEvent } from '../events/reasoning-event/types';
export type { IToolCallEvent } from '../events/tool-call/types';
