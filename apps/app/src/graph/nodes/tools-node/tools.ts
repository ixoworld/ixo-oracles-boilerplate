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
  async ({ query, maxResults = 10 }, _config) => {
    const config = _config as IRunnableConfigWithRequiredFields;
    try {
      // Get user context from the runnable config
      const userDid = config.configurable.configs?.user.did;
      const roomId = config.configurable.configs?.matrix.roomId;

      if (!userDid || !roomId) {
        throw new Error('User DID or Room ID not found in configuration');
      }
      Logger.log(
        `Searching Matrix Memory for ${query} in ${roomId} and userDid ${userDid}`,
      );
      // Query the memory engine
      const memories = await queryMemories({
        query,
        maxResults,
        roomId,
        userDid,
      });

      if (memories.facts.length === 0) {
        return {
          success: true,
          message: `No memories found for query: "${query}"`,
          results: [],
          totalFound: 0,
        };
      }

      // Format results for AI consumption

      return {
        success: true,
        message: `Found  relevant memories for "${query}"`,
        results: memories,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      return {
        success: false,
        error: `Failed to search memory engine: ${errorMessage}`,
        results: [],
        totalFound: 0,
        troubleshooting:
          'Check if the memory engine is accessible and the user has proper permissions.',
      };
    }
  },
  {
    name: 'searchConversationMemory',
    description: `Search through the conversation memory engine to find relevant past interactions, facts, and context.

This tool helps you:
- Find previous conversations with this user
- Recall important facts, preferences, or decisions mentioned earlier  
- Understand the user's history and context
- Provide personalized responses based on past interactions
- Reference specific details from previous conversations

Use this when:
- User references something from a previous conversation
- You need context about their preferences, projects, or situation
- User asks "remember when..." or "what did I tell you about..."
- You want to provide more personalized and context-aware responses
- Building on previous discussions or decisions

The search returns memories ranked by relevance, including who said what and when.`,
    schema: z.object({
      query: z.string({
        description: `What to search for in the conversation memory. Examples:
- "user's project preferences"
- "what the user said about their goals"
- "previous discussion about API integration"  
- "user's company or role"
- "decisions made in past conversations"
- "user's technical requirements"
Be specific to get better results.`,
      }),
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe(
          'Maximum number of memory results to return (1-20). Default is 10. Use fewer (3-5) for focused searches, more (15-20) for broad context gathering.',
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
        content: memory,
        role_type: 'assistant' as const,
        name: 'AI Assistant',
        timestamp: new Date().toISOString(),
      }));

      // Save memories using the matrix-memory tool
      await sendBulkSave({
        memories: formattedMemories,
        roomId,
        userDid,
      });

      return {
        success: true,
        message: `Successfully saved ${memories.length} memories`,
        savedCount: memories.length,
      };
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
    name: 'saveConversationMemory',
    description: `Save important facts from the conversation to memory for future reference. Use when user shares personal info, preferences, goals, or important details.`,
    schema: z.object({
      memories: z
        .array(z.string())
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
