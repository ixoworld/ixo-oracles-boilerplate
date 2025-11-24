import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ConfigService } from '@nestjs/config';
import 'dotenv/config';
import { type StructuredTool } from 'langchain';
import { ENV } from 'src/config';
import {
  domainIndexerSearchTool,
  getDomainCardTool,
} from './domain-indexer-tool';
import { truncate } from 'fs';
import { Logger } from '@nestjs/common';

const configService = new ConfigService<ENV>();

type SupportedTools =
  | 'memory-engine__search_memory_engine'
  | 'memory-engine__add_memory'
  | 'memory-engine__add_oracle_knowledge'
  | 'memory-engine__delete_episode'
  | 'memory-engine__delete_edge'
  | 'memory-engine__clear';

interface GetMemoryEngineMcpToolsParams {
  userDid: string;
  oracleDid: string;
  roomId: string;
  selectedTools?: SupportedTools[];
}

const getMemoryEngineMcpTools = async ({
  userDid,
  oracleDid,
  roomId,
  selectedTools = [
    'memory-engine__search_memory_engine',
    'memory-engine__add_memory',
    'memory-engine__delete_episode',
  ],
}: GetMemoryEngineMcpToolsParams) => {
  try {
    
    const client = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      prefixToolNameWithServerName: true,
      mcpServers: {
        'memory-engine': {
          type: 'http',
          transport: 'http',
          url: configService.getOrThrow('MEMORY_MCP_URL'),
          // Optional: Add auth headers if needed
          headers: {
            Authorization: `Bearer ${configService.getOrThrow(
              'MEMORY_SERVICE_API_KEY',
            )}`,
            'x-oracle-did': oracleDid,
            'x-room-id': roomId,
            'x-user-did': userDid,
            'User-Agent': 'LangChain-MCP-Client/1.0',
          },
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
    Logger.error('Error getting memory engine MCP tools', error);
    return [];
  }
};

const getFirecrawlMcpTools = async () => {
  const client = new MultiServerMCPClient({
    useStandardContentBlocks: true,
    defaultToolTimeout: 60_000, // 1 minute

    prefixToolNameWithServerName: true,
    mcpServers: {
      firecrawl: {
        type: 'http',
        transport: 'http',
        url: configService.getOrThrow('FIRECRAWL_MCP_URL'),
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
};

const tools: StructuredTool[] = [domainIndexerSearchTool, getDomainCardTool];

export { getFirecrawlMcpTools, getMemoryEngineMcpTools, tools };
