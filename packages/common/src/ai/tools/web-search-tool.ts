import { tool } from '@langchain/core/tools';
import { tavily } from '@tavily/core';
import { z } from 'zod';
import { jsonToYaml } from '../utils/json-to-yaml.js';


const webSearchTool = tool(
  async ({ input }) => {
    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const searchResults = await tvly.search(input, {
      maxResults: 3,
      includeAnswer: true,
    });

    const res = searchResults.results.map((result) =>
      jsonToYaml({
        title: result.title,
        url: result.url,
        content: result.content,
        publishedAt: result.publishedDate,
      }),
    );
    return jsonToYaml({
      query: searchResults.query,
      summary: searchResults.answer,
      results: res,
    }).replace(/[{}]/g, '');
  },
  {
    name: 'web_search_tool',
    description:
      'A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events. Input should be a search query.',
    schema: z.object({
      input: z.string({
        description: 'The query to search for',
      }),
    }),
  },
);

export { webSearchTool };
