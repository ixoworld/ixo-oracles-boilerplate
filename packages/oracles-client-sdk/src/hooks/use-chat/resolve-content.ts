import {
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
} from '@ixo/oracles-events/types';
import {
  type Event,
  evNames,
} from '../use-live-events/use-live-events.hook.js';
import { type UIComponents } from './resolve-ui-component.js';
import { type IComponentMetadata } from './v2/types.js';

type RenderComponentEventOrToolCallEvent =
  | Event<ToolCallEventPayload>
  | Event<RenderComponentEventPayload>;

// Now returns metadata instead of React elements
export const resolveContent = (
  event: Event | null,
  uiComponents: Partial<UIComponents>,
): IComponentMetadata | string => {
  if (!event) return 'Thinking...';
  const shouldRenderComponent =
    event.eventName === evNames.RenderComponent ||
    event.eventName === evNames.ToolCall;

  const isToolCall = event.eventName === evNames.ToolCall;

  if (shouldRenderComponent) {
    const payload =
      event.payload as RenderComponentEventOrToolCallEvent['payload'];

    const toolName =
      (payload as ToolCallEventPayload).toolName ||
      (payload as RenderComponentEventPayload).componentName;
    if (!toolName) return 'Thinking...';

    // Return metadata instead of rendering component
    return {
      name: toolName,
      props: {
        args: payload.args,
        id: payload.eventId ?? payload.requestId,
        status: payload.status,
        output: (payload as ToolCallEventPayload).output,
        payload,
        isToolCall,
      },
    };
  }

  return 'Thinking...';
};
