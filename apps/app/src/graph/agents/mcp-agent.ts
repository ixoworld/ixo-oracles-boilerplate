import { SqliteSaver } from '@ixo/sqlite-saver';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import {
  MultiServerMCPClient,
  type ClientConfig,
} from '@langchain/mcp-adapters';
import { Logger } from '@nestjs/common';
import { createAgent, type StructuredTool } from 'langchain';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { z } from 'zod';

import { getProviderChatModel } from '../llm-provider';
import { createSummarizationMiddleware } from '../middlewares/summarization-middleware';
import {
  normalizeUrl,
  deduplicateUrls,
  urlToServerName,
} from './main-agent/url-dedup';
import { lastMessageContent } from './subagent-as-tool';

const logger = new Logger('McpAgent');

const llm = getProviderChatModel('subagent', {
  __includeRawResponse: true,
  modelKwargs: {
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});

// ---------------------------------------------------------------------------
// Global MCP-client cache — keyed by the sorted, deduplicated URL set.
// Survives across tool invocations so we don't re-handshake every call.
// ---------------------------------------------------------------------------
const MAX_CACHE_SIZE = 50;

const clientCache = new Map<
  string,
  { client: MultiServerMCPClient; tools: StructuredTool[] }
>();

/** Build a stable cache key scoped to a user + URL set. */
const cacheKey = (userDid: string, urls: string[]) =>
  `${userDid}|${[...new Set(urls.map(normalizeUrl))].sort().join('|')}`;

/** Allowed URL protocols for MCP servers (SSRF protection). */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validate that all MCP URLs use allowed protocols.
 * Blocks `file://`, `javascript:`, `data:`, and other dangerous schemes.
 */
function validateMcpUrls(urls: string[]): void {
  for (const url of urls) {
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      throw new Error(`Invalid MCP URL: ${url}`);
    }
    if (!ALLOWED_PROTOCOLS.has(protocol)) {
      throw new Error(
        `Blocked MCP URL with disallowed protocol "${protocol}": ${url}`,
      );
    }
  }
}

/**
 * Evict the oldest cache entry (FIFO) when the cache exceeds MAX_CACHE_SIZE.
 * Closes the evicted client if possible.
 */
function evictIfNeeded(): void {
  if (clientCache.size < MAX_CACHE_SIZE) return;

  // Map iteration order is insertion order — first key is the oldest.
  const oldestKey = clientCache.keys().next().value;
  if (oldestKey == null) return;

  const evicted = clientCache.get(oldestKey);
  clientCache.delete(oldestKey);

  if (evicted) {
    try {
      // MultiServerMCPClient may expose a close method
      void evicted.client.close();
    } catch {
      // best-effort
    }
    logger.log(`Evicted oldest MCP client cache entry`);
  }
}

/**
 * Get (or create + cache) MCP tools for a given set of URLs.
 */
async function getOrCreateMcpTools(
  urls: string[],
  userDid: string,
): Promise<{ tools: StructuredTool[]; client: MultiServerMCPClient } | null> {
  const dedupedUrls = deduplicateUrls(urls);
  if (dedupedUrls.length === 0) return null;

  validateMcpUrls(dedupedUrls);

  const key = cacheKey(userDid, dedupedUrls);
  const cached = clientCache.get(key);
  if (cached) {
    logger.log(`MCP client cache hit (${dedupedUrls.length} server(s))`);
    return cached;
  }

  // Derive readable, unique server names from URLs
  const mcpServerConfig: ClientConfig['mcpServers'] = {};
  const usedNames = new Set<string>();
  for (const url of dedupedUrls) {
    mcpServerConfig[urlToServerName(url, usedNames)] = {
      type: 'http',
      transport: 'http',
      url,
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        delayMs: 2000,
      },
    };
  }

  let client: MultiServerMCPClient | undefined;
  try {
    client = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      defaultToolTimeout: 120_000, // 2 minutes

      prefixToolNameWithServerName: true,
      mcpServers: mcpServerConfig,
    });
    const tools = await client.getTools();

    if (tools.length === 0) {
      logger.warn('MCP servers returned 0 tools — not caching');
      try {
        void client.close();
      } catch {
        // best-effort
      }
      return null;
    }

    logger.log(
      `MCP client created & cached: ${tools.length} tool(s) from ${dedupedUrls.length} server(s)`,
    );

    evictIfNeeded();

    const entry = { client, tools };
    clientCache.set(key, entry);
    return entry;
  } catch (err) {
    logger.error(`Failed to connect to MCP servers`, err);
    // Clean up the client on failure
    if (client) {
      try {
        void client.close();
      } catch {
        // best-effort
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------
const mcpToolSchema = z.object({
  task: z
    .string()
    .describe(
      'A detailed, self-contained instruction for the MCP tools sub-agent. ' +
        'Include all relevant context — the sub-agent has NO conversation history.',
    ),
  urls: z
    .array(z.url())
    .min(1)
    .describe('MCP server URLs to connect to and use for this task.'),
});

/**
 * Creates a LangChain tool that spins up a sub-agent connected to the
 * requested MCP servers, runs the task, and returns the result.
 *
 * MCP clients are cached globally so repeated calls with the same URL set
 * reuse the existing connection.
 */
export function createMcpToolsAgentTool({
  userDid,
  sessionId,
}: {
  userDid: string;
  sessionId: string;
}): StructuredTool {
  return tool(
    async ({ task, urls }: z.infer<typeof mcpToolSchema>) => {
      try {
        const result = await getOrCreateMcpTools(urls, userDid);
        if (!result) {
          return 'Error: Could not connect to the provided MCP server(s) or no tools were discovered.';
        }

        const { tools } = result;

        const toolsDocs = tools
          .map((t) => `- \`${t.name}\`: ${t.description ?? 'No description'}`)
          .join('\n');

        const systemPrompt = `You are an MCP Tools Agent acting as an extension of the Main Agent.

You have live access to the following tools, discovered from the connected MCP servers:

${toolsDocs}

### Responsibilities
- Your first step is to analyze and report which tools are currently available, along with a concise summary of their functionality. This enables the Main Agent to be aware of all capabilities you can provide.
- Whenever a task is delegated to you, select the most relevant tool(s), execute them on behalf of the Main Agent, and gather real results—do not fabricate or guess information.
- If requested information can only be obtained using the above tools, you *must* use them, even if you believe you know the answer.
- Prioritize accuracy and reliability. For any tool call error or failure, clearly report the error and halt further action.
- Complete only the requested task—do not perform side operations or preemptive work unless explicitly requested by the Main Agent.
- Remain strictly within the role of bridging tasks between the Main Agent and MCP server tools: do not engage in conversation, speculate, or provide opinions.

## Response Format
- Clearly indicate which tools are available at the start of your answer, before taking further action.
- For each action you take, briefly explain which tool is being called and for what purpose.

Your job is to maximize utility for the Main Agent by leveraging these tools transparently and effectively.`;

        const checkpointer = SqliteSaver.fromDatabase(
          await UserMatrixSqliteSyncService.getInstance().getUserDatabase(
            userDid,
          ),
        );

        const agent = createAgent({
          model: llm,
          tools,
          systemPrompt,
          middleware: [createSummarizationMiddleware()],
          checkpointer,
        });

        const agentResult = await agent.invoke(
          { messages: [new HumanMessage(task)] },
          {
            configurable: {
              thread_id: `${sessionId}:mcp_tools_agent`,
            },
            runName: 'MCP Tools Agent',
          },
        );

        const messages = agentResult.messages as BaseMessage[];
        return (
          lastMessageContent(messages) || 'No response from MCP tools agent.'
        );
      } catch (err) {
        logger.error('Error running MCP Tools Agent', err);
        const message = err instanceof Error ? err.message : String(err);
        return `Error running MCP Tools Agent: ${message}`;
      }
    },
    {
      name: 'call_mcp_tools_agent',
      description:
        'Spin up a sub-agent that connects to one or more MCP servers (by URL), ' +
        'discovers their tools, and executes a task using those tools. ' +
        'Use this when you need to interact with custom MCP services.',
      schema: mcpToolSchema,
    },
  );
}
