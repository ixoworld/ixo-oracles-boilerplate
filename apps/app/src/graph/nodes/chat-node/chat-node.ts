import { getOpenRouterChatModel, parserBrowserTool } from '@ixo/common';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from '../../state';
import { getMcpTools, tools } from '../tools-node';
import { AI_ASSISTANT_PROMPT } from './prompt';

export async function chatNode(
  state: TCustomerSupportGraphState,
  config?: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const msgFromMatrixRoom = Boolean(
    state.messages.at(-1)?.additional_kwargs.msgFromMatrixRoom,
  );

  Logger.log(`msgFromMatrixRoom: ${msgFromMatrixRoom}`);
  const llm = getOpenRouterChatModel({
    model: 'openai/gpt-5-mini',
    modelKwargs: {
      require_parameters: true,
    },
  });
  const systemPrompt = await AI_ASSISTANT_PROMPT.format({
    APP_NAME: 'IXO | IXO Portal',
    USERNAME: state.userContext.name,
    COMMUNICATION_STYLE: state.userContext.communicationStyle,
    RECENT_SUMMARY: state.userContext.recentSummary,
    EXTRA_INFO: state.userContext.extraInfo,
  });
  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );

  const mcpTools = await getMcpTools();
  const chain = ChatPromptTemplate.fromMessages(
    [['system', systemPrompt], new MessagesPlaceholder('msgs')],
    {
      templateFormat: 'mustache',
    },
  )
    .pipe(llm.bindTools([...tools, ...(browserTools ?? []), ...mcpTools]))
    .withConfig({
      tags: ['chat_node'],
    });

  const result = await chain.invoke(
    {
      msgs: state.messages,
    },
    config,
  );

  result.additional_kwargs.msgFromMatrixRoom = msgFromMatrixRoom;
  result.additional_kwargs.timestamp = new Date().toISOString();

  return {
    messages: [result],
  };
}
