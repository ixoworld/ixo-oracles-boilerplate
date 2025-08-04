import {
  ToolMessage,
  type AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { isUUID } from 'class-validator';
import crypto from 'node:crypto';

interface ToolCall {
  name: string;
  id: string;
  args: unknown;
  output: string | null;
}

interface MessageDto {
  id: string;
  type: string;
  content: string;
  toolCalls?: ToolCall[];
}

export interface ListOracleMessagesResponse {
  messages: MessageDto[];
}

export function transformGraphStateMessageToListMessageResponse(
  messages: BaseMessage[],
): ListOracleMessagesResponse {
  return {
    messages: messages.reduce<MessageDto[]>((acc, message) => {
      const toolMsg =
        message.getType() === 'tool' ? (message as ToolMessage) : null;
      if (message.getType() !== 'system' && message.getType() !== 'tool') {
        acc.push({
          type: message.getType(),
          content: message.content.toString(),
          id: uuidFromString(message.id ?? message.content.toString()),
          toolCalls: (message as AIMessage).tool_calls?.map((toolCall) => ({
            name: toolCall.name,
            args: toolCall.args,
            id: toolCall.id ?? uuidFromString(JSON.stringify(toolCall.args)),
            output: null,
          })),
        });
      }
      if (toolMsg) {
        const toolCallId =
          toolMsg.lc_kwargs.tool_call_id ??
          uuidFromString(JSON.stringify(toolMsg.lc_kwargs.args));
        const messageWithToolCallIdIdx = acc.findIndex((m) =>
          m.toolCalls?.find((t) => t.id === toolCallId),
        );

        // if the message with the tool call id exits then update the tool Call to add the output
        const el =
          messageWithToolCallIdIdx !== -1
            ? acc[messageWithToolCallIdIdx]
            : null;
        if (el) {
          el.toolCalls = el.toolCalls?.map((t) =>
            t.id === toolCallId
              ? {
                  ...t,
                  output: JSON.stringify(toolMsg.content),
                  status: 'done',
                }
              : t,
          );
          acc[messageWithToolCallIdIdx] = el;
        }
      }

      return acc;
    }, []),
  };
}

export const uuidFromString = (str: string): string => {
  const isStrUUID = isUUID(str);
  if (isStrUUID) return str;
  // generate a uuid from a string
  const hash = crypto.createHash('sha256');
  hash.update(str);
  return hash.digest('hex');
};
