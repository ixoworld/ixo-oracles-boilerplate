import {
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
} from '@ixo/oracles-events';
import { createElement, type ComponentProps } from 'react';
import { type Event } from '../use-live-events/use-live-events.hook.js';
import { type ToolCallEvent, type UIComponentProps } from './v2/types.js';

export type UIComponents = Record<string, React.FC<any>>;

export const resolveUIComponent = (
  componentsMap: Partial<UIComponents>,
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

  const Component =
    component.name in componentsMap ? componentsMap[component.name] : undefined;
  if (!Component) {
    console.warn(`Component ${component.name} not found`);
    return undefined;
  }

  const isRunning = component.props.status === 'isRunning';

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

  return createElement(
    Component,
    component.props.isToolCall
      ? toolCallComponentProps
      : {
          key: `${component.name}${component.props.id}`,
          id: component.props.id,
          ...component.props.args,
          status: component.props.status, // Override args status with fresh status
          isLoading: isRunning,
        },
  );
};

const isValidProps = (
  props: unknown,
): props is ComponentProps<UIComponents[keyof UIComponents]> => {
  return typeof props === 'object' && props !== null;
};
