import {
  evNames,
  type Event,
} from '../use-live-events/use-live-events.hook.js';
import {
  resolveUIComponent,
  type UIComponents,
} from './resolve-ui-component.js';

type RenderComponentEventOrToolCallEvent = Event<{
  componentName?: string;
  toolName?: string;
  args?: unknown;

  status?: 'isRunning' | 'done';
  eventId?: string;
}>;

export const resolveContent = (
  event: Event | null,
  uiComponents: Partial<UIComponents>,
): React.ReactNode => {
  if (!event) return null;
  const shouldRenderComponent =
    event.eventName === evNames.RenderComponent ||
    event.eventName === evNames.ToolCall;

  if (shouldRenderComponent) {
    const payload =
      event.payload as RenderComponentEventOrToolCallEvent['payload'];

    const toolName = payload.toolName || payload.componentName;
    if (!toolName) return null;

    return resolveUIComponent(uiComponents, {
      name: toolName,
      props: {
        args: payload.args,
        id: payload.eventId ?? payload.requestId,
        status: payload.status,
      },
    });
  }

  return 'Thinking...';
};
