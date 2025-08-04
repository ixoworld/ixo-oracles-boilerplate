import { type VectorDBDataStore } from '@ixo/data-store';
import { Logger } from '@ixo/logger';
import { type Document } from '@langchain/core/documents';
import { type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import 'dotenv/config';
import z from 'zod';
import {
  getChatOpenAiModel,
  retrieverToolFactory,
  SELF_QUERY_RAG_PROMPT,
} from '../../index.js';

interface IFindDocsNodeRequiredState {
  question: string;
  docs: Document[];
  messages?: BaseMessage[];
  config?: {
    isInternal: boolean;
  };
  status?: 'completed' | 'inProgress';
}

/**
 * factory function that returns a Node that takes a state and config and returns a promise that resolves to a partial state.
 * @param store - The vector database data store.
 * @returns The Node that takes a state and config and returns a promise that resolves to a partial state.
 */
export const findDocsNode =
  (store: VectorDBDataStore) =>
  async (
    state: IFindDocsNodeRequiredState,
    config?: RunnableConfig,
  ): Promise<Partial<IFindDocsNodeRequiredState>> => {
    try {
      const model = getChatOpenAiModel();
      const modelWithTools = model.withStructuredOutput(
        z.object({
          questions: z.array(z.string('Generated Queries')),
        }),
      );

      const chain = ChatPromptTemplate.fromMessages([
        ['system', SELF_QUERY_RAG_PROMPT],
        [
          'user',
          state.messages
            ? `this is the last three messages from the user's conversation ${state.messages
                .map((message) => message.content)
                .slice(-3)
                .join(',')}`
            : state.question,
        ],
      ]).pipe(modelWithTools);

      const response = await chain.invoke({}, config);
      const retrieval = retrieverToolFactory({
        filters: state.config?.isInternal
          ? undefined
          : { approved: true, visibility: 'public' },
        store,
      });
      const docs = await Promise.all(
        response.questions.map(
          (question) =>
            retrieval.invoke({ query: question }) as Promise<Document[]>,
        ),
      );

      return {
        docs: docs.flat().map((value) => ({
          metadata: value.metadata,
          pageContent: value.pageContent.toString(),
          id: value.id,
        })),
        status: undefined,
      };
    } catch (error) {
      Logger.error('Error finding docs', error);
      throw error;
    }
  };
