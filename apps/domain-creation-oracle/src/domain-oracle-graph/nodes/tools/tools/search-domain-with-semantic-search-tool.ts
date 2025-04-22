import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const SEARCH_DOMAIN_WITH_SEMANTIC_SEARCH_TOOL_NAME =
  'search_domain_with_semantic_search';

export const searchDomainWithSemanticSearchTool = tool(
  async ({ domainName, searchQuery }) => {
    // call the domain registry with the search query
    const domains = [
      {
        protocolId: 'did:ixo:entity:123d410c9d91a80dabbafed0b463e4b2',
        entityId: 'did:ixo:entity:4ce80421effb121662866edf66d1cc21',
        entityName: 'CookStoves',
        entityDescription:
          'CookStoves is a domain for cook stoves; for clean cooking',
      },
      {
        protocolId: 'did:ixo:entity:123d410c9d91a80dabbafed0b463e4b2',
        entityId: 'did:ixo:entity:7a93b5f8d2e14c9a8b6d7f5e4c3b2a1c',
        entityName: 'RenewableEnergy',
        entityDescription:
          'RenewableEnergy is a domain for sustainable energy projects and initiatives',
      },
    ];
    return `Found these matching domains: ${domains
      .map(
        (domain) => `Domain
- ID: ${domain.entityId}
- Protocol ID: ${domain.protocolId}
- Name: ${domain.entityName}
- Description: ${domain.entityDescription}
______________________`,
      )
      .join('\n')}`;
  },
  {
    name: SEARCH_DOMAIN_WITH_SEMANTIC_SEARCH_TOOL_NAME,
    description: 'Search for a domain/entity with semantic search',
    schema: z.object({
      domainName: z
        .string()
        .nullable()
        .describe('The name of the domain to search for'),
      searchQuery: z
        .string()
        .describe(
          'The query to search for in the domain registry. eg "domain name" or "domain description" or "domain purpose"',
        ),
    }),
  },
);
