import { getChatOpenAiModel, parserBrowserTool } from '@ixo/common';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from '../../state';
import { tools } from '../tools-node';
import { AI_COMPANION_PROMPT } from './prompt';

export async function chatNode(
  state: TCustomerSupportGraphState,
  config?: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const msgFromMatrixRoom = Boolean(
    state.messages.at(-1)?.additional_kwargs.msgFromMatrixRoom,
  );

  Logger.log(`msgFromMatrixRoom: ${msgFromMatrixRoom}`);
  const llm = getChatOpenAiModel({
    modelName: 'gpt-4.1-nano',
  });
  const systemPrompt = await AI_COMPANION_PROMPT.format({
    APP_NAME: 'IXO Personal AI Companion | IXO Portal',
    APP_MAIN_FEATURES: 'Help user with their personal and professional goals',
    APP_PURPOSE: 'help user with their personal and professional goals',
    APP_TARGET_USERS: 'users of the IXO Portal',
    APP_UNIQUE_SELLING_POINTS: 'the best personal ai companion',
  });
  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );

  const chain = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('msgs'),
  ]).pipe(llm.bindTools([...tools, ...(browserTools ?? [])]));

  const result = await chain.invoke(
    {
      msgs: state.messages,
    },
    config,
  );

  result.additional_kwargs.msgFromMatrixRoom = msgFromMatrixRoom;

  return {
    messages: [result],
  };
}
