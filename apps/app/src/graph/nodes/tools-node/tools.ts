import { jsonToYaml, webSearchTool } from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { tool, type StructuredTool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { SlackService } from 'src/slack/slack.service';
import { z } from 'zod';
import { ChromaClientSingleton } from '../../../chroma/chroma-client.singleton';
import { queryMemories, sendBulkSave } from './matrix-memory';

const customerSupportDBSearchTool = tool(
  async ({ query }: { query: string }) => {
    const CHROMA_COLLECTION_NAME =
      process.env.CHROMA_COLLECTION_NAME || 'knowledge';
    const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

    const store = await ChromaClientSingleton.getInstance({
      collectionName: CHROMA_COLLECTION_NAME,
      url: CHROMA_URL,
    });

    Logger.log(`Searching for ${query} in ${CHROMA_COLLECTION_NAME}`);
    const results = await store.queryWithSimilarity(query, {
      topK: 4,
      similarityThreshold: 0.4,
    });
    Logger.log(`Found ${results.length} results`);
    return `Search results: ${results.map(jsonToYaml).join('\n')}`;
  },
  {
    name: 'customerSupportDBSearch',
    description:
      'Search the Knowledge base for the given input. use this tool when the user asks about the product or the company or product features or processes or general information - this data includes our blogs and faqs and product information. no customer data is included.',
    schema: z.object({
      query: z.string({
        description: 'The query to search the Knowledge base with',
      }),
    }),
  },
);

const createIssueTicketTool = tool(
  async ({
    title,
    description,
    priority,
  }: {
    title: string;
    description: string;
    priority?: 'Low' | 'Medium' | 'High';
  }) => {
    Logger.log(`Creating issue ticket: ${title}`);
    if (!process.env.SLACK_BOT_OAUTH_TOKEN || !process.env.SLACK_APP_TOKEN) {
      throw new Error('SLACK_BOT_OAUTH_TOKEN or SLACK_APP_TOKEN is not set');
    }
    const slackService = await SlackService.createInstance(
      process.env.SLACK_BOT_OAUTH_TOKEN,
      process.env.SLACK_APP_TOKEN,
    );
    const message = await slackService.postMessage({
      channel: 'C07GC8GLWJH',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🎫 New Issue Ticket',
            emoji: true,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📝 Title:* ${title}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📋 Description:*\n>${description.split('\n').join('\n>')}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*⚡ Priority:* ${priority ? `${getPriorityEmoji(priority)} ${priority}` : '🟨 Medium'}`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🕒 Created: ${new Date().toLocaleString()}`,
            },
          ],
        },
      ],
    });

    return `Issue ticket created successfully: #ID:${message.ts}`;
  },
  {
    name: 'createIssueTicket',
    description:
      'Creates a new issue ticket in the issue tracking system. Use this tool when the agent wants to add issues to the issue tracking system.',
    schema: z.object({
      title: z.string({
        description: 'The title of the issue ticket',
      }),
      description: z.string({
        description: 'Detailed description of the issue',
      }),
      priority: z
        .enum(['Low', 'Medium', 'High'], {
          description: 'Priority of the issue (Low, Medium, High)',
        })
        .optional(),
    }),
  },
);

// Helper function to get priority emoji
function getPriorityEmoji(priority: 'Low' | 'Medium' | 'High'): string {
  if (priority === 'High') return '🔴';
  if (priority === 'Low') return '🟢';
  return '🟨'; // Medium or default
}

const searchMemoryTool = tool(
  async ({ query, SearchStrategy = 'balanced', centerNodeUuid }, _config) => {
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
    schema: z.object({
      query: z.string({
        description: `Query to search in the memory graph. Example queries:
- "user's project preferences"
- "goals for 2024"
- "discussion about React Native"
- "user's role or title"
- "who user mentioned in past conversations"
`,
      }),
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
        .string()
        .uuid()
        .nullable()
        .describe(
          'Used only with "contextual" strategy to focus on a specific node (e.g., user, person, or project) or if you need to search around a specific node',
        ),
    }),
  },
);

const saveMemoryTool = tool(
  async ({ memories }, _config) => {
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

const tools: StructuredTool[] = [
  webSearchTool,
  customerSupportDBSearchTool,
  createIssueTicketTool,
  searchMemoryTool,
  saveMemoryTool,
];

export { tools };
