import {
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
} from '@ixo/oracles-events';
import { createElement, type ComponentProps } from 'react';

import { Event } from './resolve-content.js';
import { type ToolCallEvent, type UIComponentProps } from './v2/types.js';

export type UIComponents = {
  ToolCall: React.FC<UIComponentProps<ToolCallEvent> & { key: string }>;
  Error: React.FC<{
    id: string;
    args: Record<string, unknown>;
    status?: 'isRunning' | 'done';
    output?: string;
    isLoading?: boolean;
    event?: Event;
    payload?: any;
    key: string;
  }>;
  [key: string]: React.FC<any>;
};

export const resolveUIComponent = (
  componentsMap: UIComponents,
  component: {
    name: string;
    props: {
      id: string;
      args: unknown;
      status?: 'isRunning' | 'done';
      output?: string;
      event?: Event;
      payload?: ToolCallEventPayload | RenderComponentEventPayload;
      isToolCall?: boolean;
    };
  },
): React.ReactElement | undefined => {
  if (!isValidProps(component.props.args)) {
    return undefined;
  }

  // Get the component with fallback logic
  let Component: React.FC<any>;

  if (component.name in componentsMap) {
    // Use custom component if it exists
    Component = componentsMap[component.name]!;
  } else {
    // Fall back to ToolCall component for unknown tool names
    Component = componentsMap.ToolCall;
  }

  const isRunning = component.props.status === 'isRunning';

  // Create props based on component type
  if (component.name === 'Error') {
    const errorComponentProps = {
      id: component.props.id,
      args: component.props.args as Record<string, unknown>,
      status: component.props.status,
      output: component.props.output,
      isLoading: isRunning,
      event: component.props.event,
      payload: component.props.payload,
      key: `${component.name}${component.props.id}`,
    };
    return createElement(Component, errorComponentProps);
  }

  if (component.props.isToolCall) {
    const toolCallComponentProps: UIComponentProps<ToolCallEvent> & {
      key: string;
    } = {
      id: component.props.id,
      args: component.props.args,
      status: component.props.status,
      output: component.props.output,
      isLoading: isRunning,
      requestId: component.props.payload?.requestId ?? '',
      sessionId: component.props.payload?.sessionId ?? '',
      toolName: component.name,
      eventId: component.props.payload?.eventId ?? '',
      key: `${component.name}${component.props.id}`,
    };
    return createElement(Component, toolCallComponentProps);
  }

  // For other components, use generic props
  return createElement(Component, {
    key: `${component.name}${component.props.id}`,
    id: component.props.id,
    ...component.props.args,
    status: component.props.status,
    isLoading: isRunning,
  });
};

const isValidProps = (
  props: unknown,
): props is ComponentProps<UIComponents[keyof UIComponents]> => {
  return typeof props === 'object' && props !== null;
};
