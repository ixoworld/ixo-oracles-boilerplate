import { isValidElement } from 'react';
import { resolveUIComponent } from '../../helpers/resolve-ui-component';
import { type IMessage, type MessagesMap, type UIComponents } from '../types';

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
