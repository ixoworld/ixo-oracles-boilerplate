import { isValidElement } from 'react';
import {
  resolveUIComponent,
  type UIComponents,
} from './resolve-ui-component.js';

export interface IMessage {
  id: string;
  content: React.ReactNode | string;
  type: 'ai' | 'human';
  chunks?: number;
  toolCalls?: {
    name: string;
    id: string;
    args: unknown;
    status?: 'isRunning' | 'done';
    output?: string;
  }[];
}
export type MessagesMap = Record<string, IMessage>;

export default function transformToMessagesMap({
  messages,
  uiComponents,
}: {
  messages: IMessage[];
  uiComponents?: Partial<UIComponents>;
}): MessagesMap {
  const messagesMap: MessagesMap = {};

  messages.forEach((message) => {
    const isToolCall = message.toolCalls && message.toolCalls.length > 0;
    if (!isToolCall) {
      messagesMap[message.id] = message;
      return;
    }
    if (message.toolCalls && message.toolCalls.length === 0) {
      messagesMap[message.id] = message;
      return;
    }
    if (!uiComponents) {
      messagesMap[message.id] = message;
      return;
    }
    const content = [message.content];
    message.toolCalls?.forEach((toolCall) => {
      const component = resolveUIComponent(uiComponents, {
        name: toolCall.name,
        props: {
          id: toolCall.id,
          args: toolCall.args,
          status: toolCall.status,
          output: toolCall.output,
        },
      });
      const isReactElement = isValidElement(component);

      if (isReactElement) content.push(component);
    });
    messagesMap[message.id] = {
      ...message,
      content: content.filter(Boolean),
    };
  });
  return messagesMap;
}
