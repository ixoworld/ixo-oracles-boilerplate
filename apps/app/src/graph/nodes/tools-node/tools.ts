import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { type StructuredTool } from 'langchain';
import { getConfig } from 'src/config';
import {
  domainIndexerSearchTool,
  getDomainCardTool,
} from './domain-indexer-tool';

const config = getConfig();
const logger = new Logger('MemoryEngineMCP');

type SupportedTools =
  | 'memory-engine__search_memory_engine'
  | 'memory-engine__add_memory'
  | 'memory-engine__add_oracle_knowledge'
  | 'memory-engine__delete_episode'
  | 'memory-engine__delete_edge'
  | 'memory-engine__clear';

interface GetMemoryEngineMcpToolsParams {
  /** Pre-built auth headers (UCAN or Matrix) including x-room-id */
  headers: Record<string, string>;
  selectedTools?: SupportedTools[];
}

const getMemoryEngineMcpTools = async ({
  headers,
  selectedTools = [
    'memory-engine__search_memory_engine',
    'memory-engine__add_memory',
    'memory-engine__delete_episode',
  ],
}: GetMemoryEngineMcpToolsParams) => {
  // Require either UCAN auth or Matrix tokens
  const hasAuth =
    headers['X-Auth-Type'] === 'ucan' ||
    (headers['x-oracle-token'] && headers['x-user-token']);
  if (!hasAuth) {
    logger.warn('Skipping memory engine MCP — missing required auth headers');
    return [];
  }

  try {
    const client = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      prefixToolNameWithServerName: true,
      mcpServers: {
        'memory-engine': {
          type: 'http',
          transport: 'http',
          url: config.getOrThrow('MEMORY_MCP_URL'),
          headers,
          // Automatic reconnection
          reconnect: {
            enabled: true,
            maxAttempts: 3,
            delayMs: 2000,
          },
        },
      },
    });
    const allTools = await client.getTools();

    const filteredTools = allTools.filter((tool) =>
      selectedTools.includes(tool.name as SupportedTools),
    );

    return filteredTools;
  } catch (error) {
    logger.error('Error getting memory engine MCP tools:', error);
    return [];
  }
};

const getFirecrawlMcpTools = async () => {
  try {
    const client = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      defaultToolTimeout: 120_000, // 2 minutes

      prefixToolNameWithServerName: true,
      mcpServers: {
        firecrawl: {
          type: 'http',
          transport: 'http',
          url: config.getOrThrow('FIRECRAWL_MCP_URL'),
          reconnect: {
            enabled: true,
            maxAttempts: 3,
            delayMs: 2000,
          },
        },
      },
    });

    const allTools = await client.getTools();

    const allowedToolNames = [
      'firecrawl__firecrawl_scrape',
      'firecrawl__firecrawl_search',
    ];

    const filteredTools = allTools.filter((tool) =>
      allowedToolNames.includes(tool.name),
    );
    return filteredTools;
  } catch (error) {
    logger.error('Error getting firecrawl MCP tools:', error);
    return [];
  }
};

const getComposioTools = async (userId: string): Promise<StructuredTool[]> => {
  const apiKey = config.get('COMPOSIO_API_KEY');
  if (!apiKey) return [];

  try {
    const composio = new Composio({
      apiKey,
      provider: new LangchainProvider(),
    });
    const session = await composio.create(userId);
    return session.tools();
  } catch (error) {
    logger.error('Error getting Composio tools:', error);
    return [];
  }
};

const tools: StructuredTool[] = [domainIndexerSearchTool, getDomainCardTool];

export {
  getComposioTools,
  getFirecrawlMcpTools,
  getMemoryEngineMcpTools,
  tools,
};
