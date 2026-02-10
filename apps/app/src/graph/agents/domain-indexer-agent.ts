import { getOpenRouterChatModel } from '@ixo/common';
import { type StructuredTool } from 'langchain';

import {
  domainIndexerSearchTool,
  getDomainCardTool,
} from 'src/graph/nodes/tools-node/domain-indexer-tool';
import type { AgentSpec } from './subagent-as-tool';

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

const formatToolDocs = (tools: StructuredTool[]): string =>
  tools
    .map((tool) => {
      const description =
        tool.description?.trim() ?? 'No description provided.';
      return `- \`${tool.name}\`: ${description}`;
    })
    .join('\n');

const buildSystemPrompt = (tools: StructuredTool[]): string =>
  `
You are the Domain Indexer Agent. You are the specialist for searching the IXO Domain Indexer—treat it like Google for IXO entities (organizations, projects, DAOs, agents, compositions, events).

Core expectations:
- Always clarify the user’s goal and translate it into a concrete search query or DID lookup.
- Never call tools with empty parameters; \`domain_indexer_search\` always needs a query, \`get_domain_card\` always needs a DID.
- Explain what you are searching for, summarize the results, and cite relevant DIDs or entity names.
- When multiple results appear, compare them briefly and suggest next steps.

### Available Domain Indexer Tools
${formatToolDocs(tools)}

Workflow:
1. Decide if you need search (find relevant entities) or a card lookup (get summary/overview/FAQ for a known DID).
2. Provide detailed, structured tool inputs (query text, limits, filters, or DID).
3. Parse the response—highlight summary, overview, FAQ, URLs, and keywords.
4. Surface gaps or follow-ups (e.g., “Need more info from memory engine or portal to proceed”).
`.trim();

const buildDescription = (tools: StructuredTool[]) => {
  const names = tools.map((tool) => tool.name).join(', ');
  return `Domain Indexer specialist using (${names}) to discover IXO entities, summaries, overviews, and FAQs.`;
};

export type DomainIndexerAgentInstance = AgentSpec;

export const createDomainIndexerAgent =
  async (): Promise<DomainIndexerAgentInstance> => {
    const tools = [domainIndexerSearchTool, getDomainCardTool];

    return {
      name: 'Domain Indexer Agent',
      description: buildDescription(tools),
      tools,
      systemPrompt: buildSystemPrompt(tools),
      model: llm,
      middleware: [],
    };
  };
