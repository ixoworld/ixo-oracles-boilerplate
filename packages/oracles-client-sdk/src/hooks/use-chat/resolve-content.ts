import {
  type BrowserToolCallEventPayload,
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
  type WithRequiredEventProps,
} from '@ixo/oracles-events/types';

import { SSEErrorEvent } from '../../utils/sse-parser.js';
import { type IComponentMetadata } from './v2/types.js';

export type Event<T = Record<string, any>> = {
  eventName: 'tool_call' | 'render_component' | 'browser_tool_call' | 'error';
  payload: WithRequiredEventProps<T> | SSEErrorEvent;
};

// Now returns metadata instead of React elements
export const resolveContent = (
  event: Event | null,
): IComponentMetadata | string => {
  if (!event) return 'Thinking...';

  switch (event.eventName) {
    case 'tool_call': {
      const payload = event.payload as ToolCallEventPayload;
      return {
        name: payload.toolName,
        props: {
          args: payload.args,
          id: payload.eventId ?? payload.requestId,
          status: payload.status,
          output: payload.output,
          payload: payload,
          isToolCall: true,
          toolName: payload.toolName,
          event: event,
        },
      };
    }
    case 'render_component': {
      const payload = event.payload as RenderComponentEventPayload;
      return {
        name: payload.componentName,
        props: {
          args: payload.args,
          id: payload.eventId ?? payload.requestId,
          status: payload.status,
        },
      };
    }
    case 'browser_tool_call': {
      const payload = event.payload as BrowserToolCallEventPayload;
      return {
        name: payload.toolName,
        props: {
          args: payload.args,
          id: payload.toolCallId,
          status: 'done',
          event: event,
          payload: payload,
          isToolCall: true,
          toolName: payload.toolName,
        },
      };
    }
    case 'error': {
      const payload = event.payload as SSEErrorEvent;
      return {
        name: 'Error',
        props: {
          id: 'error',
          args: {},
          status: 'done',
          output: payload.error,
          event: event,
          payload: payload,
        },
      };
    }
  }

  return 'Thinking...';
};
