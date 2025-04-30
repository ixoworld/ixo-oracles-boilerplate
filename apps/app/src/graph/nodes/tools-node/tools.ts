import { jsonToYaml, webSearchTool } from '@ixo/common';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { SlackService } from 'src/slack/slack.service';
import { z } from 'zod';
import { ChromaClientSingleton } from '../../../chroma/chroma-client.singleton';

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
    if (
      !process.env.SLACK_BOT_OAUTH_TOKEN ||
      !process.env.SLACK_APP_LEVEL_TOKEN
    ) {
      throw new Error(
        'SLACK_BOT_OAUTH_TOKEN or SLACK_APP_LEVEL_TOKEN is not set',
      );
    }
    const slackService = await SlackService.createInstance(
      process.env.SLACK_BOT_OAUTH_TOKEN,
      process.env.SLACK_APP_LEVEL_TOKEN,
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

const tools = [
  webSearchTool,
  customerSupportDBSearchTool,
  createIssueTicketTool,
];

export { tools };
