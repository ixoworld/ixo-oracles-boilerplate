import {
  getOpenRouterChatModel,
  parserBrowserTool,
  SearchEnhancedResponse,
} from '@ixo/common';
import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from '../../state';
import { getMemoryEngineMcpTools, tools } from '../tools-node';
import { AI_ASSISTANT_PROMPT } from './prompt';

export async function chatNode(
  state: TCustomerSupportGraphState,
  config?: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const msgFromMatrixRoom = Boolean(
    state.messages.at(-1)?.additional_kwargs.msgFromMatrixRoom,
  );

  const { configurable } = config as IRunnableConfigWithRequiredFields;
  const { matrix } = configurable?.configs ?? {};
  Logger.log(`msgFromMatrixRoom: ${msgFromMatrixRoom}`);

  const llm = getOpenRouterChatModel({
    model: 'openai/gpt-oss-120b:nitro',
    modelKwargs: {
      require_parameters: true,
    },
  });

  const systemPrompt = await AI_ASSISTANT_PROMPT.format({
    APP_NAME: 'IXO | IXO Portal',
    IDENTITY_CONTEXT: formatContextData(state.userContext.identity),
    WORK_CONTEXT: formatContextData(state.userContext.work),
    GOALS_CONTEXT: formatContextData(state.userContext.goals),
    INTERESTS_CONTEXT: formatContextData(state.userContext.interests),
    RELATIONSHIPS_CONTEXT: formatContextData(state.userContext.relationships),
    RECENT_CONTEXT: formatContextData(state.userContext.recent),
  });

  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );
  if (!configurable?.configs?.user?.did) {
    throw new Error('User DID is required');
  }

  const mcpTools = await getMemoryEngineMcpTools({
    userDid: configurable?.configs?.user?.did,
    oracleDid: matrix?.oracleDid ?? '',
    roomId: matrix?.roomId ?? '',
  });
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

// Helper function to format SearchEnhancedResponse into readable context
const formatContextData = (data: SearchEnhancedResponse | undefined) => {
  if (!data) return 'No specific information available.';

  let context = '';

  if (data.facts && data.facts.length > 0) {
    context += '**Key Facts:**\n';
    data.facts.slice(0, 3).forEach((fact: any) => {
      context += `- ${fact.fact}\n`;
    });
  }

  if (data.entities && data.entities.length > 0) {
    context += '\n**Relevant Entities:**\n';
    data.entities.slice(0, 3).forEach((entity: any) => {
      context += `- ${entity.name}: ${entity.summary}\n`;
    });
  }

  if (data.episodes && data.episodes.length > 0) {
    context += '\n**Recent Episodes:**\n';
    data.episodes.slice(0, 2).forEach((episode: any) => {
      context += `- ${episode.name}: ${episode.content.substring(0, 100)}...\n`;
    });
  }

  return context || 'No specific information available.';
};
