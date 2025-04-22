import { ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { SEARCH_DOMAIN_WITH_SEMANTIC_SEARCH_TOOL_NAME } from './search-domain-with-semantic-search-tool.js';
export const SELECT_DOMAIN_TOOL_NAME = 'select_domain';

export const selectDomainTool = tool(
  async ({ domainId }, config) => {
    return new Command({
      update: {
        messages: [
          new ToolMessage({
            content: `Selected domain with ID: ${domainId}`,
            tool_call_id: config.toolCall.id,
            name: SELECT_DOMAIN_TOOL_NAME,
            status: 'success',
          }),
        ],
        selectedProtocol: domainId,
      },
    });
  },
  {
    name: SELECT_DOMAIN_TOOL_NAME,
    description: `Select/choose a domain from the list of domains that was provided from the ${SEARCH_DOMAIN_WITH_SEMANTIC_SEARCH_TOOL_NAME} tool`,
    schema: z.object({
      domainId: z
        .string()
        .describe(
          'The ID of the domain to select from the list of domains provided from the search_domain_with_semantic_search tool',
        ),
    }),
  },
);
