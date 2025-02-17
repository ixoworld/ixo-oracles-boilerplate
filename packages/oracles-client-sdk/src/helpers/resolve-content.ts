import { type UIComponents } from '../messages/types';
import { type Event } from '../use-live-events';
import { resolveUIComponent } from './resolve-ui-component';

export type RenderComponentEventOrToolCallEvent = Event<{
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
    event.eventName === 'render_component' || event.eventName === 'tool_call';

  if (shouldRenderComponent) {
    const payload = event.payload;

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
