import { getOpenRouterChatModel } from '@ixo/common';
import { SubAgent } from 'deepagents';
import { type StructuredTool } from 'langchain';

import { getFirecrawlMcpTools } from '../nodes/tools-node';

const llm = getOpenRouterChatModel({
  model: 'openai/gpt-oss-120b:nitro',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
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
`.trim();

const workflowGuidelines = `
### Workflow
1. Clarify the user's objective and decide whether to \`firecrawl_search\` or
   \`firecrawl_scrape\`.
2. If unsure which tool to use, consult the tool description before invoking it.
3. Provide well-structured tool inputs (queries, URLs, options) exactly as the
   tool expects.
4. After a tool call, interpret the results, highlight key insights, and cite
   sources where available.
5. If Firecrawl cannot satisfy the request, explain why and suggest next steps.
`.trim();

const formatToolDocs = (tools: StructuredTool[]): string => {
  if (!tools.length) {
    return '- No Firecrawl tools are currently configured.';
  }

  return tools
    .map((tool) => {
      const description =
        tool.description?.trim() ?? 'No description provided.';
      return `- \`${tool.name}\`: ${description}`;
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

export type FirecrawlAgentInstance = Awaited<SubAgent>;

export interface CreateFirecrawlAgentParams {
  extraInstructions?: string;
}

export const createFirecrawlAgent = async ({
  extraInstructions,
}: CreateFirecrawlAgentParams = {}): Promise<FirecrawlAgentInstance> => {
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
  };
};
