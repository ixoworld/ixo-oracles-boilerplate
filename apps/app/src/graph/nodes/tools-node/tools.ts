import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { type StructuredTool, tool } from '@langchain/core/tools';
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
  memories: z.array(
    z.object({
      content: z.string().describe('The content of the memory'),
      username: z.string().describe('The username of the memory'),
    }),
  ),
});

const saveMemoryTool = tool(
  async ({ memories }: z.infer<typeof saveMemoryToolSchema>, _config) => {
    const config = _config as IRunnableConfigWithRequiredFields;
    try {
      // Get user context from the runnable config
      const userDid = config.configurable.configs?.user.did;
      const roomId = config.configurable.configs?.matrix.roomId;

      if (!userDid || !roomId) {
        throw new Error('User DID or Room ID not found in configuration');
      }

      // Convert string memories to proper format
      const formattedMemories = memories.map((memory) => ({
        content: memory.content,
        role_type: 'assistant' as const,
        name: memory.username,
        timestamp: new Date().toISOString(),
      }));

      // Save memories using the matrix-memory tool
      await sendBulkSave({
        memories: formattedMemories,
        roomId,
        userDid,
      });

      return `Successfully saved ${memories.length} memories`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      return {
        success: false,
        error: `Failed to save memories: ${errorMessage}`,
        savedCount: 0,
      };
    }
  },
  {
    name: 'saveConversationMemoryTool',
    description: `Save important facts from the conversation to memory for future reference. Use when user shares personal info, preferences, goals, or important details.`,
    schema: z.object({
      memories: z
        .array(
          z.object({
            content: z.string().describe('The content of the memory'),
            username: z.string().describe('The username of the memory'),
          }),
        )
        .min(1)
        .describe(
          'Array of important facts to remember. Examples: "User is a React developer", "User prefers morning meetings", "User has deadline next Friday"',
        ),
    }),
  },
);

const tools: StructuredTool[] = [searchMemoryTool, saveMemoryTool];

export { tools };
