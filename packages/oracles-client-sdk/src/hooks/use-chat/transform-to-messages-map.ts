import { type UIComponents } from './resolve-ui-component.js';
import {
  type IComponentMetadata,
  type IMessage,
  type MessageContent,
} from './v2/types.js';

export type MessagesMap = Record<string, IMessage>;

export default function transformToMessagesMap({
  messages,
  uiComponents,
}: {
  messages: IMessage[];
  uiComponents?: UIComponents;
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

    // Store metadata instead of React elements - build array of content
    const content: Array<string | IComponentMetadata> = [];

    // Add original content if it's a string
    if (typeof message.content === 'string') {
      content.push(message.content);
    }

    // Add component metadata for each tool call
    message.toolCalls?.forEach((toolCall) => {
      // Check if there's a custom UI component for this specific tool
      // If not, fall back to generic "ToolCall" component
      const hasCustomComponent = uiComponents && toolCall.name in uiComponents;

      const componentMetadata: IComponentMetadata = {
        name: hasCustomComponent ? toolCall.name : 'ToolCall',
        props: {
          id: toolCall.id,
          args: toolCall.args,
          status: toolCall.status,
          output: toolCall.output,
          isToolCall: true,
          toolName: toolCall.name, // Pass original tool name for generic component
        },
      };
      content.push(componentMetadata);
    });

    messagesMap[message.id] = {
      ...message,
      content: content.filter(Boolean) as MessageContent,
    };
  });
  return messagesMap;
}
