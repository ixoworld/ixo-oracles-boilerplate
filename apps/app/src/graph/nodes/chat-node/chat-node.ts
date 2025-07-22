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
    model: 'qwen/qwen3-14b', //qwen3-30b-a3b
    temperature: 0.8,
    apiKey: process.env.OPEN_ROUTER_API_KEY,
    // reasoningEffort: 'medium',
    timeout: 20 * 1000 * 60, // 20 minutes
    modelKwargs: {
      reasoning: {
        effort: 'medium',
        exclude: false, // Use reasoning but don't include it in the response
        enabled: true, // Default: inferred from `effort` or `max_tokens`
      },
      require_parameters: true,
    },
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
    },
  });
  const systemPrompt = await AI_COMPANION_PROMPT.format({
    APP_NAME: 'IXO Personal AI Companion | IXO Portal',
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

  const chain = ChatPromptTemplate.fromMessages(
    [['system', systemPrompt], new MessagesPlaceholder('msgs')],
    {
      templateFormat: 'mustache',
    },
  )
    .pipe(llm.bindTools([...tools, ...(browserTools ?? [])]))
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
