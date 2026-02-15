import { getOpenRouterChatModel } from '@ixo/common';
import { type DynamicStructuredTool, type StructuredTool } from 'langchain';

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

const sharedExpectations = `
You are the Portal Agent for this workspace. Your entire job is to operate the
user portal/UI on behalf of the user by calling the available tools responsibly.

Core expectations:
- Be the helpful front-line assistant for anything that can be done via the
  portal tools you have access to.
- Never guess which tool to use—reference each tool's description and required
  inputs before invoking it.
- Narrate your intent before triggering a tool, confirm the result afterwards,
  and clearly communicate next steps or follow-up questions.
- Respect safety, data-privacy, and authorization boundaries described by each
  tool.
`.trim();

const workflowGuidelines = `
### Workflow
1. Clarify the user's goal and map it to one (or more) portal tools.
2. Call \`help\` or consult the tool description if you are unsure how it works.
3. Pass parameters exactly as documented; never guess IDs or omit required
   fields.
4. Summarize results back to the user, highlighting any outstanding actions or
   follow-ups.
5. If no tool can satisfy the request, explain why and suggest alternatives.
`.trim();

const formatToolDocs = (tools: StructuredTool[]): string => {
  if (!tools.length) {
    return '- No portal tools configured. Ask a human operator for support.';
  }

  return tools
    .map((tool) => {
      const description =
        tool.description?.trim() ?? 'No description provided.';
      return `- \`${tool.name}\`: ${description}`;
    })
    .join('\n');
};

const buildPortalPrompt = ({
  toolsDoc,
  extraInstructions,
}: {
  toolsDoc: string;
  extraInstructions?: string;
}) =>
  `
${sharedExpectations}

### Available Portal Tools
${toolsDoc}

${workflowGuidelines}

${extraInstructions ? `### Additional Instructions\n${extraInstructions}` : ''}
`.trim();

const buildPortalDescription = (tools: StructuredTool[]): string => {
  const names =
    tools.map((tool) => tool.name).join(', ') || 'no configured tools';
  return `Specialized Portal Agent that executes user-facing portal/UI supported actions are (${names}).`;
};

export type PortalAgentInstance = AgentSpec;

export interface CreatePortalAgentParams {
  tools: (StructuredTool | DynamicStructuredTool)[];
}

export const createPortalAgent = async ({
  tools,
}: CreatePortalAgentParams): Promise<PortalAgentInstance> => {
  const toolsDoc = formatToolDocs(tools);

  const systemPrompt = buildPortalPrompt({
    toolsDoc,
  });

  return {
    name: 'Portal Agent',
    description: buildPortalDescription(tools),
    tools,
    systemPrompt,
    model: llm,
    middleware: [],
  };
};
