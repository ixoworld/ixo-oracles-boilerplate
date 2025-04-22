import { Logger } from '@ixo/logger';
import { BaseMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { StructuredTool, Tool } from '@langchain/core/tools';
import { getChatOpenAiModel } from 'src/ai/models/openai.js';
import { GENERIC_CHAT_PROMPT, InputVariables } from './generic-chat.prompt.js';

type StateWithMessages<S extends object> = {
  messages: BaseMessage[];
} & S;

export const createGenericChatNode = (
  inputVariables: InputVariables,
  tools: (Tool | StructuredTool)[],
  llm = getChatOpenAiModel(),
) => {
  return async <S extends object>(
    state: StateWithMessages<S>,
    config?: RunnableConfig,
  ) => {
    Logger.debug('Generic chat node called', {
      state,
      config,
    });

    let systemPrompt = '';
    try {
      systemPrompt = await GENERIC_CHAT_PROMPT.format(inputVariables);
    } catch (error) {
      Logger.error('Error formatting system prompt', error);
      throw error;
    }

    const chain = ChatPromptTemplate.fromMessages([
      ['system', systemPrompt],
      new MessagesPlaceholder('msgs'),
    ]).pipe(llm.bindTools(tools));

    const result = await chain.invoke(
      {
        msgs: state.messages,
      },
      config,
    );

    Logger.debug('Generic chat node result', {
      result,
    });

    return {
      messages: [result],
    };
  };
};
