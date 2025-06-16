import { getChatOpenAiModel, parserBrowserTool } from '@ixo/common';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import { tools } from '../nodes/tools-node';
import { type TCustomerSupportGraphState } from '../state';
import { CUSTOMER_SUPPORT_PROMPT } from './prompt';

export async function chatNode(
  state: TCustomerSupportGraphState,
  config?: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const llm = getChatOpenAiModel({
    modelName: 'gpt-4o-mini',
  });
  const systemPrompt = await CUSTOMER_SUPPORT_PROMPT.format({
    APP_NAME: 'Custom support',
    APP_MAIN_FEATURES: 'Help user',
    APP_PURPOSE: 'help user',
    APP_TARGET_USERS: 'users',
    APP_UNIQUE_SELLING_POINTS: 'the best',
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

  return {
    messages: [result],
  };
}
