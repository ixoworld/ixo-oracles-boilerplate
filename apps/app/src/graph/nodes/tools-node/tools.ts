import { jsonToYaml, webSearchTool } from '@ixo/common';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { z } from 'zod';
import { ChromaClientSingleton } from '../../../chroma/chroma-client.singleton';

const customerSupportDBSearchTool = tool(
  async ({ query }: { query: string }) => {
    const CHROMA_COLLECTION_NAME =
      process.env.CHROMA_COLLECTION_NAME || 'knowledge';
    const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

    const store = await ChromaClientSingleton.getInstance({
      collectionName: CHROMA_COLLECTION_NAME,
      url: CHROMA_URL,
    });

    Logger.log(`Searching for ${query} in ${CHROMA_COLLECTION_NAME}`);
    const result = await store.queryWithSimilarity(query);
    Logger.log(`Found ${result.length} results`);
    return `Search results: ${result.map(jsonToYaml).join('\n')}`;
  },
  {
    name: 'customerSupportDBSearch',
    description:
      'Search the customer support database for the given input. use this tool when the user asks about the product or the company',
    schema: z.object({
      query: z.string({
        description: 'The query to search the customer support database with',
      }),
    }),
  },
);

const tools = [webSearchTool, customerSupportDBSearchTool];

export { tools };
