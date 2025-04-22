import { getChatOpenAiModel } from '@ixo/common';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { Langfuse } from 'langfuse-langchain';
import { DomainCreationOracleState } from '../state.js';
import { tools } from './tools/tools.nodes.js';

// domain-oracle

const langfuse = new Langfuse({
  secretKey: 'sk-lf-1b73f7a8-c83f-4226-b4d6-32b8f5f6b917',
  publicKey: 'pk-lf-e261489e-20ce-4a26-a554-b88b58658598',
  baseUrl: 'http://localhost:3000', // 🇪🇺 EU region
});

export const domainCreatorNode = async (
  state: DomainCreationOracleState,
  runnableConfig: RunnableConfig,
) => {
  const prompt = await langfuse.getPrompt('domain-oracle');

  const chain = ChatPromptTemplate.fromMessages([
    ['system', prompt.getLangchainPrompt()],
    new MessagesPlaceholder('msgs'),
  ])
    .pipe(getChatOpenAiModel().bindTools(tools))
    .withConfig({
      metadata: { langfusePrompt: prompt },
    });

  const result = await chain.invoke({
    msgs: state.messages,
  });

  return {
    messages: [result],
  };
};
