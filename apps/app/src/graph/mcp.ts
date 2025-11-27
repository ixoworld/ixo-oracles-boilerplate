import { ClientConfig, MultiServerMCPClient } from '@langchain/mcp-adapters';
import { Logger } from '@nestjs/common';
import { type StructuredTool } from 'langchain';

const mcpConfig: ClientConfig = {
  useStandardContentBlocks: true,
  prefixToolNameWithServerName: true,
  mcpServers: {
    // postgres: {
    //   command: 'docker',
    //   args: [
    //     'run',
    //     '-i',
    //     '--rm',
    //     '-e',
    //     'DATABASE_URI',
    //     'crystaldba/postgres-mcp',
    //     '--access-mode=restricted',
    //   ],
    //   env: {
    //     DATABASE_URI:
    //       'postgresql://michael:password@localhost:5432/Adventureworks',
    //   },
    // },
  },
};

/**
 * Creates an MCP client configured with multiple server connections
 * @param config - Configuration object with server definitions
 * @returns Configured MultiServerMCPClient instance
 */
export const createMCPClient = (config: ClientConfig): MultiServerMCPClient | undefined => {
  if (!config || Object.keys(config).length === 0) {
    Logger.warn('Creating MCP client with empty configuration');
    return
  }

  try {
    const client = new MultiServerMCPClient(config);
    Logger.log(
      `🔌 MCP client created with ${Object.keys(config.mcpServers).length} server(s): ${Object.keys(config.mcpServers).join(', ')}`,
    );
    return client;
  } catch (error) {
    Logger.error('Failed to create MCP client:', error);
    throw error;
  }
};

/**
 * Creates and retrieves tools from the MCP client
 * @returns Array of structured tools ready for agent integration
 */
export const createMCPClientAndGetTools = async (): Promise<
  StructuredTool[]
> => {
  try {
    const client = createMCPClient(mcpConfig);
    if (!client) {
      return [];
    }
    const tools = await client.getTools();
    Logger.log(`✅ Successfully loaded ${tools.length} MCP tool(s)`);
    return tools;
  } catch (error) {
    Logger.error('Failed to get MCP tools:', error);
    return [];
    // throw error;
  }
};
