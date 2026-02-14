import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import {
  createAgent,
  type AgentMiddleware,
  type StructuredTool,
} from 'langchain';
import { z } from 'zod';

/**
 * Spec for an agent that can be run as a one-shot subagent (no checkpointer).
 * Replaces deepagents' SubAgent for the subagents-as-tools pattern.
 * tools is optional for compatibility with existing specs that may omit it.
 */
export interface AgentSpec {
  name: string;
  description: string;
  tools?: StructuredTool[];
  systemPrompt: string;
  model?: Parameters<typeof createAgent>[0]['model'];
  middleware?: AgentMiddleware[];
}

const querySchema = z.object({
  query: z.string().describe('Task or question for the agent'),
});

function lastMessageContent(messages: { content?: unknown }[]): string {
  const last = messages.at(-1);
  if (!last?.content) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    const textPart = last.content.find(
      (block: { type?: string; text?: string }) =>
        block.type === 'text' && block.text,
    );
    return (textPart as { text?: string } | undefined)?.text ?? '';
  }
  return String(last.content);
}

/**
 * Wraps an AgentSpec as a LangChain tool. When the main agent calls this tool
 * with a query, an ephemeral agent is run (model + tools + systemPrompt), and
 * the final reply text is returned.
 */
export function createSubagentAsTool(spec: AgentSpec): StructuredTool {
  const base = spec.name.toLowerCase().replace(/\s+/g, '_');
  const toolName = base.endsWith('_agent')
    ? `call_${base}`
    : `call_${base}_agent`;
  return tool(
    async ({ query }: z.infer<typeof querySchema>) => {
      try {
        if (!spec.model) {
          return `Error: ${spec.name} has no model configured.`;
        }
        const agent = createAgent({
          model: spec.model,
          tools: spec.tools ?? [],
          systemPrompt: spec.systemPrompt,
          middleware: spec.middleware ?? [],
        });
        const result = await agent.invoke({
          messages: [new HumanMessage(query)],
        });
        return lastMessageContent(result.messages as { content?: unknown }[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error running ${spec.name}: ${message}`;
      }
    },
    {
      name: toolName,
      description: spec.description,
      schema: querySchema,
    },
  );
}
