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
  status?: 'isRunning' | 'done';
  output?: string;
}

interface MessageDto {
  id: string;
  type: 'ai' | 'human';
  content: string;
  toolCalls?: ToolCall[];
  reasoning?: string;
  isComplete?: boolean;
  isReasoning?: boolean;
}

export interface ListOracleMessagesResponse {
  messages: MessageDto[];
}
export interface CleanAdditionalKwargs {
  msgFromMatrixRoom: boolean;
  timestamp: string;
  oracleName: string;
  reasoning?: string;
  reasoningDetails?: Array<{
    type: string;
    text: string;
  }>;
  [key: string]: unknown; // Allow additional properties for LangChain compatibility
}

export function transformGraphStateMessageToListMessageResponse(
  messages: BaseMessage[],
): ListOracleMessagesResponse {
  return {
    messages: messages.reduce<MessageDto[]>((acc, message) => {
      const toolMsg = message.type === 'tool' ? (message as ToolMessage) : null;
      if (message.type !== 'system' && message.type !== 'tool' && !message.additional_kwargs?.isError) {
        // Extract reasoning from additional_kwargs
        const additionalKwargs =
          message.additional_kwargs as CleanAdditionalKwargs;
        const reasoning = additionalKwargs?.reasoning;

        acc.push({
          type: message.type === 'ai' ? 'ai' : 'human',
          content: message.content.toString(),
          id: uuidFromString(message.id ?? message.content.toString()),
          toolCalls: (message as AIMessage).tool_calls?.map((toolCall) => ({
            name: toolCall.name,
            args: toolCall.args,
            id: toolCall.id ?? uuidFromString(JSON.stringify(toolCall.args)),
            output: undefined,
          })),
          reasoning,
          isComplete: true, // Messages from DB are always complete
          isReasoning: false, // since this is not a reasoning message and the request is done
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
