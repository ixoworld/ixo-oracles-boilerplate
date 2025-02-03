import { type VectorDBDataStore } from '@ixo/data-store';
import { Logger } from '@ixo/logger';
import { Document } from '@langchain/core/documents';
import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import { type DynamicStructuredTool, tool } from '@langchain/core/tools';
import z from 'zod';
import { getChatOpenAiModel } from '../../models/openai';
import checkDocRelevance from '../../utils/doc-relevance-checker';

type RetrieverToolFactoryArgs<
  Filters extends Record<string, unknown> = Record<string, unknown>,
  MapType extends Map<string, unknown> = Map<string, unknown>,
> = {
  model?: BaseChatModel;
  filters?: Filters;
  similarThreshold?: number;
  store: VectorDBDataStore;
  map?: MapType;
  requestId?: string;
};

const schema = z.object({
  query: z.string(),
});

export const retrieverToolFactory = ({
  model = getChatOpenAiModel(),
  filters,
  similarThreshold = 0.3,
  map,
  requestId,
  store,
}: RetrieverToolFactoryArgs): DynamicStructuredTool<typeof schema> =>
  tool(
    async ({ query }) => {
      const docs = await store.queryWithSimilarity(query, {
        similarityThreshold: similarThreshold,
        filters,
      });

      // save the results to the map if the parent class wan to access the docs used by the Agent
      if (map) {
        map.set(
          requestId ?? query,
          docs.map((doc) => doc.metadata),
        );
      }

      if (docs.length === 0) {
        return undefined;
      }

      if (similarThreshold >= 0.3) {
        // Filter the docs based on relevance using the AI
        const relevantDocs = await Promise.all(
          docs.map(async (doc) => {
            try {
              return (
                await checkDocRelevance({
                  doc: new Document({
                    pageContent: doc.content,
                    id: doc.id,
                    metadata: doc.metadata,
                  }),
                  query,
                  model,
                })
              ).valueOf()
                ? doc
                : null;
            } catch (error) {
              Logger.error(`Error checking relevance of document:`, error);
              return null;
            }
          }),
        );

        return relevantDocs.reduce<Document[]>((acc, doc) => {
          if (doc) {
            acc.push(
              new Document({
                pageContent: doc.content,
                id: doc.id,
                metadata: doc.metadata,
              }),
            );
          }
          return acc;
        }, []);
      }

      return docs.map(
        (doc) =>
          new Document({
            pageContent: doc.content,
            id: doc.id,
            metadata: doc.metadata,
          }),
      );
    },
    {
      name: 'retrieverTool',
      description:
        'Retrieves documents from the knowledge base based on the query',
      schema,
    },
  );
