import {
  type BrowserToolCallEventPayload,
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
  type WithRequiredEventProps,
} from '@ixo/oracles-events/types';

import { type SSEActionCallEventData, type SSEErrorEvent } from '../../utils/sse-parser.js';
import { getToolName } from '../../utils/get-tool-name.js';
import { type IComponentMetadata } from './v2/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Event<T = Record<string, any>> = {
  eventName:
    | 'tool_call'
    | 'render_component'
    | 'browser_tool_call'
    | 'action_call'
    | 'error';
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
        name: getToolName(payload.toolName, (payload.args as Record<string, unknown>)?.toolName as string | undefined),
        props: {
          args: payload.args,
          id: payload.eventId ?? payload.requestId,
          status: payload.status,
          output: payload.output,
          payload,
          isToolCall: true,
          toolName: getToolName(payload.toolName, (payload.args as Record<string, unknown>)?.toolName as string | undefined),
          event,
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
          event,
          payload,
          isToolCall: true,
          toolName: payload.toolName,
        },
      };
    }
    case 'action_call': {
      const payload = event.payload as WithRequiredEventProps<SSEActionCallEventData>;
      return {
        name: payload.toolName,
        props: {
          args: payload.args,
          id: payload.toolCallId ?? payload.requestId,
          status: payload.status,
          output: payload.output,
          payload,
          isAgAction: true,
          toolName: payload.toolName,
          event,
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
          event,
          payload,
        },
      };
    }
  }

  return 'Thinking...';
};
