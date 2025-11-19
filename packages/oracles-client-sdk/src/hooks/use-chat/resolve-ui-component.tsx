import { createElement, type ComponentProps } from 'react';

import { Event } from './resolve-content.js';
import { DEFAULT_TOOL_CALL_COMPONENT_NAME } from './transform-to-messages-map.js';
import {
  IComponentMetadata,
  type ToolCallEvent,
  type UIComponentProps,
} from './v2/types.js';

export type UIComponents = {
  ToolCall: React.FC<UIComponentProps<ToolCallEvent> & { key: string }>;
  AgActionToolCall?: React.FC<{
    id: string;
    actionName: string;
    args?: Record<string, unknown>;
    output?: string;
    status?: 'isRunning' | 'done' | 'error';
    error?: string;
    isLoading?: boolean;
    isCurrentlyRendered?: boolean;
    onRenderClick?: () => void;
    key: string;
  }>;
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
  [key: string]: React.FC<any> | undefined;
};

export const resolveUIComponent = (
  componentsMap: UIComponents,
  component: IComponentMetadata,
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
    return createElement(Component!, errorComponentProps);
  }

  if (component.props.isToolCall) {
    const toolCallComponentProps: UIComponentProps<ToolCallEvent> & {
      key: string;
    } = {
      id: component.props.id,
      args: component.props.args,
      status: component.props.status as 'isRunning' | 'done' | undefined,
      output: component.props.output,
      isLoading: isRunning,
      requestId: component.props.payload
        ? 'requestId' in component.props.payload
          ? component.props.payload.requestId
          : ''
        : '',
      sessionId: component.props.payload
        ? 'sessionId' in component.props.payload
          ? component.props.payload.sessionId
          : ''
        : '',
      toolName:
        component.name === DEFAULT_TOOL_CALL_COMPONENT_NAME
          ? (component.props.toolName ?? component.name)
          : component.name,
      eventId: component.props.payload
        ? 'eventId' in component.props.payload
          ? component.props.payload.eventId
          : ''
        : '',
      key: `${component.name}${component.props.id}`,
    };
    return createElement(Component, toolCallComponentProps);
  }

  if (component.props.isAgAction) {
    // Use AgActionToolCall if available, otherwise fallback to ToolCall
    const AgActionComponent =
      componentsMap.AgActionToolCall || componentsMap.ToolCall;

    const agActionComponentProps = {
      id: component.props.id,
      actionName: component.name,
      args: component.props.args,
      output: component.props.output,
      status: component.props.status,
      error: component.props.error,
      isLoading: isRunning,
      key: `${component.name}${component.props.id}`,
    };
    return createElement(
      AgActionComponent as React.FC<any>,
      agActionComponentProps,
    );
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

const isValidProps = (props: unknown): props is ComponentProps<any> => {
  return typeof props === 'object' && props !== null;
};
