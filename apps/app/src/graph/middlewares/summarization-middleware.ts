import {
  AIMessage,
  getBufferString,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  ToolMessage,
  trimMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import {
  countTokensApproximately,
  createMiddleware,
  type AgentMiddleware,
} from 'langchain';
import { randomUUID } from 'node:crypto';
import { getProviderChatModel } from '../llm-provider';

type TokenCounter = (messages: BaseMessage[]) => number | Promise<number>;

const TRIGGER_MESSAGE_COUNT = 20;
const MESSAGES_TO_KEEP = 10;
const TRIM_TOKEN_LIMIT = 4000;
const FALLBACK_MESSAGE_COUNT = 15;
const SEARCH_RANGE_FOR_TOOL_PAIRS = 5;

const SUMMARY_PROMPT = `<role>
Context Extraction Assistant
</role>

<primary_objective>
Extract the most important context from the conversation history below. This extracted context will REPLACE the full conversation history, so capture everything the agent needs to continue working effectively.
</primary_objective>

<critical_identifiers>
You MUST preserve ALL of the following VERBATIM — copy them exactly as they appear:
- DIDs (decentralized identifiers, e.g. did:ixo:..., did:x:..., did:key:...)
- Matrix Room IDs (e.g. !abc123:matrix.ixo.world)
- Wallet/account addresses (e.g. ixo1..., cosmos1...)
- Session IDs, thread IDs, or checkpoint IDs
- Blockchain transaction hashes or entity IDs
- Any URLs, endpoints, or API paths referenced
- Block IDs (UUIDs) from document editing
Do NOT paraphrase, abbreviate, or omit any of these identifiers.
</critical_identifiers>

<what_to_extract>
1. **Active task**: What is the agent currently working on? What was the user's most recent request?
2. **Key decisions & outcomes**: What has been decided or completed so far?
3. **Pending actions**: What still needs to be done?
4. **Important data**: Any structured data, configurations, or parameters the agent was working with
5. **All identifiers**: Every DID, room ID, address, hash listed above — verbatim
6. **Tool results**: Key outputs from tool calls that inform next steps
7. **Errors or blockers**: Any issues encountered that are still relevant
</what_to_extract>

<format>
Structure the extracted context clearly with sections. Be concise but complete — the agent will lose all context not captured here.
Respond ONLY with the extracted context. No preamble, no explanation.
</format>

<messages>
Messages to summarize:
{messages}
</messages>`;

const SUMMARY_PREFIX = 'Here is a summary of the conversation to date:';

// ---------------------------------------------------------------------------
// Helpers ported from langchain's summarizationMiddleware
// ---------------------------------------------------------------------------

function hasToolCalls(msg: BaseMessage): boolean {
  return (
    AIMessage.isInstance(msg) &&
    Array.isArray((msg as AIMessage).tool_calls) &&
    (msg as AIMessage).tool_calls!.length > 0
  );
}

function ensureMessageIds(messages: BaseMessage[]): void {
  for (const msg of messages) {
    if (!msg.id) msg.id = randomUUID();
  }
}

function splitSystemMessage(messages: BaseMessage[]): {
  systemPrompt?: SystemMessage;
  conversationMessages: BaseMessage[];
} {
  if (messages.length > 0 && SystemMessage.isInstance(messages[0])) {
    return {
      systemPrompt: messages[0],
      conversationMessages: messages.slice(1),
    };
  }
  return { conversationMessages: messages };
}

function partitionMessages(
  systemPrompt: SystemMessage | undefined,
  conversationMessages: BaseMessage[],
  cutoffIndex: number,
): { messagesToSummarize: BaseMessage[]; preservedMessages: BaseMessage[] } {
  const messagesToSummarize = conversationMessages.slice(0, cutoffIndex);
  const preservedMessages = conversationMessages.slice(cutoffIndex);
  if (systemPrompt) messagesToSummarize.unshift(systemPrompt);
  return { messagesToSummarize, preservedMessages };
}

function extractToolCallIds(aiMessage: AIMessage): Set<string> {
  const ids = new Set<string>();
  if (aiMessage.tool_calls) {
    for (const tc of aiMessage.tool_calls) {
      const id = typeof tc === 'object' && 'id' in tc ? tc.id : null;
      if (id) ids.add(id);
    }
  }
  return ids;
}

function cutoffSeparatesToolPair(
  messages: BaseMessage[],
  aiMessageIndex: number,
  cutoffIndex: number,
  toolCallIds: Set<string>,
): boolean {
  for (let j = aiMessageIndex + 1; j < messages.length; j++) {
    const message = messages[j];
    if (
      ToolMessage.isInstance(message) &&
      toolCallIds.has((message as ToolMessage).tool_call_id)
    ) {
      if (aiMessageIndex < cutoffIndex !== j < cutoffIndex) return true;
    }
  }
  return false;
}

function isSafeCutoffPoint(
  messages: BaseMessage[],
  cutoffIndex: number,
): boolean {
  if (cutoffIndex >= messages.length) return true;

  if (
    AIMessage.isInstance(messages[cutoffIndex]) &&
    hasToolCalls(messages[cutoffIndex])
  ) {
    return false;
  }

  const searchStart = Math.max(0, cutoffIndex - SEARCH_RANGE_FOR_TOOL_PAIRS);
  const searchEnd = Math.min(
    messages.length,
    cutoffIndex + SEARCH_RANGE_FOR_TOOL_PAIRS,
  );

  for (let i = searchStart; i < searchEnd; i++) {
    if (!hasToolCalls(messages[i])) continue;
    const toolCallIds = extractToolCallIds(messages[i] as AIMessage);
    if (cutoffSeparatesToolPair(messages, i, cutoffIndex, toolCallIds))
      return false;
  }

  return true;
}

function findSafeCutoffPoint(
  messages: BaseMessage[],
  cutoffIndex: number,
): number {
  if (
    cutoffIndex >= messages.length ||
    !ToolMessage.isInstance(messages[cutoffIndex])
  ) {
    return cutoffIndex;
  }

  const toolCallIds = new Set<string>();
  let idx = cutoffIndex;
  while (idx < messages.length && ToolMessage.isInstance(messages[idx])) {
    const toolMsg = messages[idx] as ToolMessage;
    if (toolMsg.tool_call_id) toolCallIds.add(toolMsg.tool_call_id);
    idx++;
  }

  for (let i = cutoffIndex - 1; i >= 0; i--) {
    const msg = messages[i];
    if (AIMessage.isInstance(msg) && hasToolCalls(msg)) {
      const aiToolCallIds = extractToolCallIds(msg as AIMessage);
      for (const id of toolCallIds) {
        if (aiToolCallIds.has(id)) return i;
      }
    }
  }

  return idx;
}

function findSafeCutoff(
  messages: BaseMessage[],
  messagesToKeep: number,
): number {
  if (messages.length <= messagesToKeep) return 0;

  const targetCutoff = messages.length - messagesToKeep;
  const safeCutoff = findSafeCutoffPoint(messages, targetCutoff);

  if (safeCutoff <= targetCutoff) return safeCutoff;

  for (let i = targetCutoff; i >= 0; i--) {
    if (isSafeCutoffPoint(messages, i)) return i;
  }

  return 0;
}

async function trimMessagesForSummary(
  messages: BaseMessage[],
  tokenCounter: TokenCounter,
  trimTokensToSummarize: number,
): Promise<BaseMessage[]> {
  try {
    return await trimMessages(messages, {
      maxTokens: trimTokensToSummarize,
      tokenCounter: async (msgs) => tokenCounter(msgs),
      strategy: 'last',
      allowPartial: true,
      includeSystem: true,
    });
  } catch {
    return messages.slice(-FALLBACK_MESSAGE_COUNT);
  }
}

async function createSummaryText(
  messagesToSummarize: BaseMessage[],
  tokenCounter: TokenCounter,
): Promise<string> {
  if (!messagesToSummarize.length) return 'No previous conversation history.';

  const trimmed = await trimMessagesForSummary(
    messagesToSummarize,
    tokenCounter,
    TRIM_TOKEN_LIMIT,
  );
  if (!trimmed.length)
    return 'Previous conversation was too long to summarize.';

  const formatted = getBufferString(trimmed);
  const prompt = SUMMARY_PROMPT.replace('{messages}', formatted);

  try {
    const model = getProviderChatModel('routing');
    const response = await model.invoke(prompt);
    const content = response.content;

    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item !== null && 'text' in item)
            return (item as { text: string }).text;
          return '';
        })
        .join('')
        .trim();
    }
    return 'Error generating summary: Invalid response format';
  } catch (e) {
    return `Error generating summary: ${e}`;
  }
}

// ---------------------------------------------------------------------------
// Middleware export
// ---------------------------------------------------------------------------

export const createSummarizationMiddleware = (): AgentMiddleware => {
  const logger = new Logger('SummarizationMiddleware');

  return createMiddleware({
    name: 'SummarizationMiddleware',

    beforeModel: async (state) => {
      const { messages } = state;
      if (messages.length < TRIGGER_MESSAGE_COUNT) return;

      ensureMessageIds(messages);

      const tokenCounter: TokenCounter = countTokensApproximately;
      const totalTokens = await tokenCounter(messages);

      // Check trigger: message count
      if (messages.length < TRIGGER_MESSAGE_COUNT) return;

      logger.log(
        `Triggering summarization: ${messages.length} messages, ~${totalTokens} tokens`,
      );

      const { systemPrompt, conversationMessages } =
        splitSystemMessage(messages);

      const cutoffIndex = findSafeCutoff(
        conversationMessages,
        MESSAGES_TO_KEEP,
      );
      if (cutoffIndex <= 0) return;

      const { messagesToSummarize, preservedMessages } = partitionMessages(
        systemPrompt,
        conversationMessages,
        cutoffIndex,
      );

      const summaryText = await createSummaryText(
        messagesToSummarize,
        tokenCounter,
      );

      const summaryMessage = new HumanMessage({
        content: `${SUMMARY_PREFIX}\n\n${summaryText}`,
        id: randomUUID(),
        additional_kwargs: { lc_source: 'summarization' },
      });

      logger.log(
        `Summarized ${messagesToSummarize.length} messages, keeping ${preservedMessages.length}`,
      );

      return {
        messages: [
          new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
          summaryMessage,
          ...preservedMessages,
        ],
      };
    },
  });
};
