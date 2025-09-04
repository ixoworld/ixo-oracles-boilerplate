import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { type StructuredTool, tool } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { z } from 'zod';
import { queryMemories, sendBulkSave } from './matrix-memory';

const searchMemoryToolSchema = z.object({
  query: z.string(`Query to search in the memory graph. Example queries:
- "user's project preferences"
- "goals for 2024"
- "discussion about React Native"
- "user's role or title"
- "who user mentioned in past conversations"
`),
  SearchStrategy: z
    .enum([
      'balanced',
      'recent_memory',
      'contextual',
      'precise',
      'entities_only',
      'topics_only',
    ])
    .optional()
    .default('balanced'),
  centerNodeUuid: z
    .uuid()
    .nullable()
    .describe(
      'Used only with "contextual" strategy to focus on a specific node (e.g., user, person, or project) or if you need to search around a specific node',
    ),
});
const searchMemoryTool = tool(
  async (input: z.infer<typeof searchMemoryToolSchema>, _config) => {
    const { query, SearchStrategy, centerNodeUuid } = input;
    const config = _config as IRunnableConfigWithRequiredFields;

    try {
      const userDid = config.configurable.configs?.user.did;
      const roomId = config.configurable.configs?.matrix.roomId;

      if (!userDid || !roomId) {
        throw new Error('Missing user DID or memory group ID');
      }

      Logger.log(
        `🔍 Searching Graphiti memory using strategy="${SearchStrategy}" for query="${query}" in groupId="${userDid}"`,
      );

      // Validate contextual strategy
      if (SearchStrategy === 'contextual' && !centerNodeUuid) {
        throw new Error(
          'centerNodeUuid is required for contextual search strategy.',
        );
      }

      const results = await queryMemories({
        query,
        strategy: SearchStrategy,
        roomId,
        userDid,
        centerNodeUuid: centerNodeUuid ?? undefined,
        oracleDid:
          (config as IRunnableConfigWithRequiredFields).configurable.configs
            ?.matrix.oracleDid ?? '',
      });

      return {
        success: true,
        results,
        message: `✅ Found results using "${SearchStrategy}" strategy for: "${query}"`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        error: `❌ Memory search failed: ${errorMessage}`,
        results: [],
        totalFound: 0,
        troubleshooting:
          'Ensure user DID and group ID are set and search strategy is valid.',
      };
    }
  },
  {
    name: 'searchMemoryEngine',
    description: `Search Graphiti memory for personalized user context, preferences, and facts using advanced strategies.

Use this tool to:
- Recall user preferences, routines, decisions, relationships, and timelines
- Support contextual follow-ups using 'recent_memory' or 'contextual' strategies
- Provide continuity across sessions by referencing stored facts or episodes

Strategies:
- 'balanced' (default): General purpose, fast, and relevant
- 'recent_memory': Pull recent episodes, ideal for ongoing conversations
- 'contextual': Target related info using a center node (e.g. specific person or topic)
- 'precise': For accurate factual answers
- 'entities_only', 'topics_only': For traits or topic exploration

Always prefer searching memory before responding when prior context may help.`,
    schema: searchMemoryToolSchema,
  },
);

const saveMemoryToolSchema = z.object({
  memory: z
    .string()
    .describe('Important fact to remember (e.g., "User is a React developer")'),
});

const saveMemoryTool = tool(
  async ({ memory }: z.infer<typeof saveMemoryToolSchema>, _config) => {
    const config = _config as IRunnableConfigWithRequiredFields;
    try {
      // Get user context from the runnable config
      const userDid = config.configurable.configs?.user.did;
      const roomId = config.configurable.configs?.matrix.roomId;
      const oracleDid = config.configurable.configs?.matrix.oracleDid;

      if (!userDid || !roomId || !oracleDid) {
        throw new Error('User DID or Room ID not found in configuration');
      }

      // Convert single memory to proper format
      const formattedMemory = {
        content: memory,
        role_type: 'user' as const,
        name: 'user',
        timestamp: new Date().toISOString(),
      };

      // Save memory using the matrix-memory tool
      await sendBulkSave({
        memories: [formattedMemory],
        roomId,
        userDid,
        oracleDid,
      });

      return `Successfully saved memory: "${memory}"`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      return `Failed to save memory: ${errorMessage}`;
    }
  },
  {
    name: 'saveMemoryTool',
    description:
      'Save one important fact to memory. Use when user shares personal info, preferences, or important details.',
    schema: saveMemoryToolSchema,
  },
);

const client = new MultiServerMCPClient({
  useStandardContentBlocks: true,
  mcpServers: {
    'memory-engine': {
      transport: 'sse', // or just omit transport field
      url: 'http://localhost:8988/mcp',
      // Optional: Add auth headers if needed
      headers: {
        Authorization: 'Bearer your-token-here', // if you add auth later
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

const getMcpTools = async () => {
  return await client.getTools();
};

const tools: StructuredTool[] = [searchMemoryTool, saveMemoryTool];

export { tools, getMcpTools };
