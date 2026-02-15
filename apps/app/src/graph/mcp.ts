import { type ClientConfig, MultiServerMCPClient } from '@langchain/mcp-adapters';
import { Logger } from '@nestjs/common';
import { DynamicStructuredTool, type StructuredTool } from 'langchain';
import { type UcanService } from 'src/ucan/ucan.service';

/**
 * Configuration for UCAN-protected MCP servers
 * Map of server name to whether it requires UCAN authorization
 */
export interface MCPUCANServerConfig {
  /** Whether this MCP server requires UCAN authorization */
  requiresUcan: boolean;
}

/**
 * Extended MCP config with UCAN requirements
 */
export interface MCPConfigWithUCAN extends ClientConfig {
  /** UCAN requirements per MCP server */
  ucanConfig?: Record<string, MCPUCANServerConfig>;
}

const mcpConfig: MCPConfigWithUCAN = {
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
  // UCAN configuration per MCP server
  ucanConfig: {
    // Example: postgres requires UCAN authorization
    // postgres: { requiresUcan: true },
  },
};

/**
 * Parse MCP tool name to extract server and tool names
 * Tool names from MCP adapters are prefixed with server name: "serverName__toolName"
 *
 * @param toolName - The full tool name (e.g., "postgres__query")
 * @returns The parsed server and tool names
 */
export function parseMCPToolName(toolName: string): {
  serverName: string;
  toolName: string;
} {
  const parts = toolName.split('__');
  if (parts.length >= 2) {
    return {
      serverName: parts[0],
      toolName: parts.slice(1).join('__'),
    };
  }
  // Fallback: treat as tool name only
  return {
    serverName: 'unknown',
    toolName,
  };
}

/**
 * Context for UCAN validation during tool execution
 */
export interface MCPUCANContext {
  /** Map of tool names to their serialized invocations */
  invocations: Record<string, string>;
}

/**
 * Wrap an MCP tool with UCAN validation
 *
 * @param tool - The original MCP tool
 * @param ucanService - The UCAN service for validation
 * @param getContext - Function to get the current UCAN context
 * @param serverConfig - UCAN configuration for this server
 * @returns A wrapped tool that validates UCAN before execution
 */
export function wrapMCPToolWithUCAN(
  tool: StructuredTool,
  ucanService: UcanService,
  getContext: () => MCPUCANContext | undefined,
  serverConfig?: MCPUCANServerConfig,
): StructuredTool {
  // If no UCAN required, return original tool
  if (!serverConfig?.requiresUcan) {
    return tool;
  }

  const { serverName, toolName } = parseMCPToolName(tool.name);

  // Create a wrapped tool that validates UCAN before execution
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    func: async (input: Record<string, unknown>, _runManager) => {
      // Get current UCAN context
      const context = getContext();

      if (!context?.invocations) {
        return `Error: UCAN authorization required for ${tool.name}. No invocations provided in request.`;
      }

      // Look up invocation for this tool
      const invocation = context.invocations[tool.name];
      if (!invocation) {
        return `Error: UCAN authorization required for ${tool.name}. No invocation found for this tool. Please provide a valid UCAN invocation.`;
      }

      // Validate the invocation
      const validationResult = await ucanService.validateMCPInvocation(
        serverName,
        toolName,
        invocation,
      );

      if (!validationResult.valid) {
        Logger.warn(
          `UCAN validation failed for ${tool.name}: ${validationResult.error}`,
        );
        return `Error: UCAN authorization failed for ${tool.name}: ${validationResult.error}`;
      }

      Logger.log(
        `✅ UCAN validated for ${tool.name} by ${validationResult.invokerDid}`,
      );

      // Execute the original tool
      try {
        // Call the original tool's invoke method
        // Note: We don't pass runManager directly as it has incompatible types
        const result = await tool.invoke(input);
        return result;
      } catch (error) {
        Logger.error(`Error executing ${tool.name}:`, error);
        throw error;
      }
    },
  });
}

/**
 * Creates an MCP client configured with multiple server connections
 * @param config - Configuration object with server definitions
 * @returns Configured MultiServerMCPClient instance
 */
export const createMCPClient = (
  config: ClientConfig,
): MultiServerMCPClient | undefined => {
  if (!config || Object.keys(config).length === 0) {
    Logger.warn('Skipping MCP client creation with empty configuration');
    return undefined;
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
    const hasServers = Object.keys(mcpConfig.mcpServers).length > 0;
    if (!hasServers) {
      return [];
    }
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

/**
 * Creates MCP tools wrapped with UCAN validation
 *
 * @param ucanService - The UCAN service for validation
 * @param getContext - Function to get the current UCAN context
 * @returns Array of UCAN-wrapped tools
 *
 * @example
 * ```typescript
 * // In main-agent.ts
 * const mcpTools = await createMCPClientAndGetToolsWithUCAN(
 *   ucanService,
 *   () => state.mcpUcanContext
 * );
 * ```
 */
export const createMCPClientAndGetToolsWithUCAN = async (
  ucanService: UcanService,
  getContext: () => MCPUCANContext | undefined,
): Promise<StructuredTool[]> => {
  try {
    const hasServers = Object.keys(mcpConfig.mcpServers).length > 0;
    if (!hasServers) {
      return [];
    }
    const client = createMCPClient(mcpConfig);
    if (!client) {
      return [];
    }
    const tools = await client.getTools();

    // Wrap each tool with UCAN validation if configured
    const wrappedTools = tools.map((tool) => {
      const { serverName } = parseMCPToolName(tool.name);
      const serverConfig = mcpConfig.ucanConfig?.[serverName];

      if (serverConfig?.requiresUcan) {
        Logger.log(`🔒 Wrapping ${tool.name} with UCAN validation`);
        return wrapMCPToolWithUCAN(tool, ucanService, getContext, serverConfig);
      }

      return tool;
    });

    Logger.log(
      `✅ Successfully loaded ${wrappedTools.length} MCP tool(s) (${Object.keys(mcpConfig.ucanConfig ?? {}).length} with UCAN protection)`,
    );
    return wrappedTools;
  } catch (error) {
    Logger.error('Failed to get MCP tools:', error);
    return [];
  }
};

/**
 * Get the list of MCP servers that require UCAN authorization
 * Useful for informing clients which tools need invocations
 */
export function getUCANProtectedServers(): string[] {
  return Object.entries(mcpConfig.ucanConfig ?? {})
    .filter(([_, config]) => config.requiresUcan)
    .map(([serverName]) => serverName);
}

// TODO: Add support for per-tool UCAN configuration (not just per-server)
// TODO: Add capability requirement inspection endpoint
// TODO: Add UCAN middleware for tool execution logging
