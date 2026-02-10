import { getOpenRouterChatModel } from '@ixo/common';
import { createMCPClient } from 'src/graph/mcp';
import { listSkillsTool, searchSkillsTool } from 'src/graph/nodes/tools-node';
import type { AgentSpec } from '../subagent-as-tool';
import { presentFilesTool } from './present-files-tool';
import { SKILLS_PROMPT } from './skills.prompt';

const llm = getOpenRouterChatModel({
  model: 'qwen/qwen3-235b-a22b-thinking-2507:nitro',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
    include_reasoning: true,
  },
  reasoning: {
    effort: 'medium',
  },
});

const sandboxMCP = createMCPClient({
  mcpServers: {
    sandbox: {
      type: 'http',
      url: 'http://localhost:8787/mcp',
      transport: 'http',
      headers: {
        Authorization: `Bearer ${process.env.SANDBOX_API_KEY}`,
      },
    },
  },
});
export const createSkillsAgent = async (): Promise<AgentSpec> => ({
  name: 'Skills Agent',
  description: 'A agent that uses skills to help the user',
  tools: [
    presentFilesTool,
    ...((await sandboxMCP?.getTools()) ?? []),
    listSkillsTool,
    searchSkillsTool,
  ],
  model: llm,
  middleware: [],
  systemPrompt: SKILLS_PROMPT,
});
