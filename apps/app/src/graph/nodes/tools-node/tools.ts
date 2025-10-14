import { type StructuredTool } from 'langchain';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ConfigService } from '@nestjs/config';
import 'dotenv/config';
import { ENV } from 'src/config';

const configService = new ConfigService<ENV>();

interface GetMemoryEngineMcpToolsParams {
  userMatrixOpenIdToken: string;
  oracleDid: string;
  roomId: string;
}

const getMemoryEngineMcpTools = async ({
  userMatrixOpenIdToken,
  oracleDid,
  roomId,
}: GetMemoryEngineMcpToolsParams) => {
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
          'x-api-key': configService.getOrThrow('MEMORY_MCP_API'),
          Authorization: `Bearer ${userMatrixOpenIdToken}`,
          'x-oracle-did': oracleDid,
          'x-room-id': roomId,
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
  return await client.getTools();
};

const tools: StructuredTool[] = [];

export { getMemoryEngineMcpTools, tools };
