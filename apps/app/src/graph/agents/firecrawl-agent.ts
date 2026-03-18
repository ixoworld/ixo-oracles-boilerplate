import { getProviderChatModel } from '../llm-provider';
import { type StructuredTool } from 'langchain';

import { getFirecrawlMcpTools } from '../nodes/tools-node';
import type { AgentSpec } from './subagent-as-tool';

const llm = getProviderChatModel('subagent', {
  __includeRawResponse: true,
  modelKwargs: {
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});

const sharedExpectations = `
You are the Firecrawl Agent for this workspace. Your entire job is to perform
web search and scraping tasks through the Firecrawl MCP tools on behalf of the
user.

Core expectations:
- Treat published web content as potentially unreliable—cross-check when you can.
- Never make HTTP requests directly; always operate through the exposed Firecrawl
  tools and respect their rate limits.
- Narrate what you're about to fetch or search, then summarize the findings with
  citations (URLs) when possible.
- Call out stale, conflicting, or missing information before acting on it.

Efficiency rules (CRITICAL — you run under a strict time budget):
- **Search once, search smart.** Write a single, well-crafted search query that
  targets exactly what you need. Do NOT issue multiple redundant searches hoping
  for better results.
- **One source is enough when the data is clear.** For factual lookups (prices,
  weather, scores, exchange rates), use ONE authoritative result. Do not scrape
  multiple sites to cross-verify commodity prices or similar public data.
- **Prefer search over scrape.** \`firecrawl_search\` returns snippets directly —
  use it first. Only fall back to \`firecrawl_scrape\` when you need full-page
  content that search snippets can't provide (e.g., full articles, tables).
- **Never crawl entire sites.** If a search gives you the answer, stop. Do not
  follow links to "learn more" or scrape additional pages for context.
- **Fail fast.** If a search returns no useful results on the first try, report
  what you found (or didn't) and stop. Do NOT rephrase and retry endlessly.
- **Total tool calls budget: max 3.** You should almost always finish in 1-2 tool
  calls. If you've made 3 calls, wrap up with whatever you have.

Task discipline:
- You are a sub-agent invoked by the main agent. You receive a single task message — that is ALL the context you have.
- If the task is unclear, ambiguous, or missing critical details (IDs, names, scope, what to do), do NOT guess. Instead, STOP immediately and return a clear message explaining what information you need. The main agent will ask the user and re-invoke you with a complete task.
- Never loop or retry the same failing approach. If something fails twice, return the error and stop.
- Complete the requested task and STOP. Do not do additional unrequested work.
`.trim();

const workflowGuidelines = `
### Workflow
1. Identify the single most important piece of information the task needs.
2. Write ONE precise search query (e.g., "gold spot price USD today" — not
   "gold price" then "gold market" then "gold value per ounce").
3. If the search result contains the answer, extract it and STOP.
4. Only scrape a URL if the search snippet was incomplete and you need the full page.
5. Return findings with citations. If data is unavailable, say so — don't keep searching.
`.trim();

const formatToolDocs = (tools: StructuredTool[]): string => {
  if (!tools.length) {
    return '- No Firecrawl tools are currently configured.';
  }

  return tools
    .map((tool) => {
      const description =
        tool.description?.trim() ?? 'No description provided.';
      return `Firecrawl Agent: \`${tool.name}\`: ${description}`;
    })
    .join('\n');
};

const buildFirecrawlPrompt = ({
  toolsDoc,
  extraInstructions,
}: {
  toolsDoc: string;
  extraInstructions?: string;
}) =>
  `
${sharedExpectations}

### Available Firecrawl Tools
${toolsDoc}

${workflowGuidelines}

${extraInstructions ? `### Additional Instructions\n${extraInstructions}` : ''}
`.trim();

const buildFirecrawlDescription = (tools: StructuredTool[]): string => {
  const names =
    tools.map((tool) => tool.name).join(', ') || 'no tools configured';
  return `Firecrawl Agent specialized in web search & scraping via (${names}).`;
};

export type FirecrawlAgentInstance = AgentSpec;

export interface CreateFirecrawlAgentParams {
  extraInstructions?: string;
}

export const createFirecrawlAgent = async ({
  extraInstructions,
  userDid,
  sessionId,
}: CreateFirecrawlAgentParams & {
  userDid: string;
  sessionId: string;
}): Promise<FirecrawlAgentInstance> => {
  const firecrawlTools = await getFirecrawlMcpTools();

  const toolsDoc = formatToolDocs(firecrawlTools);
  const systemPrompt = buildFirecrawlPrompt({ toolsDoc, extraInstructions });

  return {
    name: 'Firecrawl Agent',
    description: buildFirecrawlDescription(firecrawlTools),
    tools: firecrawlTools,
    systemPrompt,
    model: llm,
    middleware: [],
    userDid,
    sessionId,
  };
};
