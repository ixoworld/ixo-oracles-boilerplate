/**
 * Fire-and-forget memory logging for page and block operations.
 * Sends structured summaries to the Memory Engine so the oracle can
 * recall page activity in future conversations.
 */

import { type BaseMessage, ToolMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { getConfig } from 'src/config';
import { type PageDiff } from './page-functions';

export interface PageMemoryAuth {
  oracleToken: string;
  userToken: string;
  oracleHomeServer: string;
  userHomeServer: string;
  chatRoomId: string;
}

const MUTATION_TOOLS = new Set([
  'edit_block',
  'create_block',
  'delete_block',
  'bulk_edit_blocks',
  'fill_survey_answers',
  'execute_action',
  'find_and_replace',
  'move_block',
  'create_page',
  'update_page',
]);

interface MemoryMessage {
  content: string;
  role: 'assistant';
  role_type: 'assistant';
  name: string;
  source_description: string;
}

async function sendToMemoryEngine(
  auth: PageMemoryAuth,
  messages: MemoryMessage[],
): Promise<void> {
  const memoryEngineUrl = getConfig().get('MEMORY_ENGINE_URL');
  if (!memoryEngineUrl) {
    Logger.debug('[PageMemory] No MEMORY_ENGINE_URL configured, skipping');
    return;
  }
  Logger.log(
    `[PageMemory] Sending ${messages.length} message(s) to ${memoryEngineUrl}/messages (room: ${auth.chatRoomId})`,
  );

  const response = await fetch(`${memoryEngineUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-oracle-token': auth.oracleToken,
      'x-user-token': auth.userToken,
      'x-oracle-matrix-homeserver': auth.oracleHomeServer,
      'x-user-matrix-homeserver': auth.userHomeServer,
      'x-room-id': auth.chatRoomId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    Logger.warn(
      `[PageMemory] Memory Engine responded ${response.status}: ${errorText}`,
    );
  } else {
    Logger.log(
      `[PageMemory] Successfully logged ${messages.length} message(s) to memory`,
    );
  }
}

/**
 * Log a standalone page create/update operation to the Memory Engine.
 */
export async function logPageOperationToMemory(
  auth: PageMemoryAuth,
  operation: 'created' | 'updated',
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const title = details.title || details.roomId || 'Untitled';
    Logger.log(
      `[PageMemory] Logging page ${operation}: "${title}" (room: ${details.roomId})`,
    );
    const lines: string[] = [
      `[Page ${operation === 'created' ? 'Created' : 'Updated'}] "${title}" (room: ${details.roomId})`,
    ];

    if (operation === 'created') {
      if (details.ownerDid) lines.push(`Owner: ${details.ownerDid}`);
      if (details.createdAt) lines.push(`Created: ${details.createdAt}`);
      if (details.blockCount) lines.push(`Blocks: ${details.blockCount}`);
      if (details.alias) lines.push(`Alias: ${details.alias}`);
      if (details.content) lines.push(`Content:\n${details.content}`);
    } else {
      if (details.ownerDid) lines.push(`Owner: ${details.ownerDid}`);
      if (details.updatedAt) lines.push(`Updated at: ${details.updatedAt}`);
      if (details.updatedFields)
        lines.push(
          `Updated fields: ${Array.isArray(details.updatedFields) ? (details.updatedFields as string[]).join(', ') : details.updatedFields}`,
        );
      if (details.blockCount) lines.push(`Block count: ${details.blockCount}`);
      // Render diff details
      const diff = details.diff as PageDiff | undefined;
      if (diff?.title)
        lines.push(`Title changed: "${diff.title.old}" → "${diff.title.new}"`);
      if (diff?.topic)
        lines.push(`Topic changed: "${diff.topic.old}" → "${diff.topic.new}"`);
      if (diff?.content) {
        lines.push(`Previous content:\n${diff.content.old}`);
        lines.push(`New content:\n${diff.content.new}`);
      }
      if (details.content)
        lines.push(`Replacement content:\n${details.content}`);
      if (details.appendContent)
        lines.push(`Appended content:\n${details.appendContent}`);
    }

    if (details.spaceId) lines.push(`Space: ${details.spaceId}`);

    await sendToMemoryEngine(auth, [
      {
        content: lines.join('\n'),
        role: 'assistant',
        role_type: 'assistant',
        name: 'Page Operation Tracker',
        source_description: 'page-operation-tracker',
      },
    ]);
  } catch (e) {
    Logger.warn(`[PageMemory] Failed to log page operation: ${e}`);
  }
}

/**
 * Log a batched editor session summary to the Memory Engine.
 * Scans the editor agent's message history for mutation tool calls
 * and sends a single enriched summary.
 */
export function logEditorSessionToMemory(
  auth: PageMemoryAuth,
  messages: BaseMessage[],
  editorRoomId: string,
  userQuery: string,
): void {
  Logger.log(
    `[PageMemory] Editor session completed for room ${editorRoomId}, scanning ${messages.length} messages for mutations`,
  );
  // Fire-and-forget — run async but don't block
  void (async () => {
    try {
      // Collect mutation tool results
      const mutations: { toolName: string; result: string }[] = [];
      let pageTitle: string | undefined;

      // Build a map of tool_call_id -> tool_name from AIMessages
      const toolCallNameMap = new Map<string, string>();
      for (const msg of messages) {
        if (msg.type === 'ai') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolCalls = (msg as any).tool_calls ?? [];
          for (const tc of toolCalls) {
            if (tc.id && tc.name) {
              toolCallNameMap.set(tc.id, tc.name);
            }
          }
        }
      }

      for (const msg of messages) {
        if (!(msg instanceof ToolMessage)) continue;
        const toolName = toolCallNameMap.get(msg.tool_call_id);

        // Try to extract page title from read_flow_context
        if (toolName === 'read_flow_context') {
          try {
            const parsed = JSON.parse(
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content),
            );
            pageTitle =
              parsed?.metadata?.title ||
              parsed?.metadata?.docName ||
              parsed?.title;
          } catch {
            // ignore parse errors
          }
        }

        if (toolName && MUTATION_TOOLS.has(toolName)) {
          mutations.push({
            toolName,
            result:
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content),
          });
        }
      }

      if (mutations.length === 0) {
        Logger.debug(
          `[PageMemory] No mutation tool calls found in editor session for room ${editorRoomId}, skipping`,
        );
        return;
      }

      Logger.log(
        `[PageMemory] Found ${mutations.length} mutation(s) in editor session for room ${editorRoomId}: ${[...new Set(mutations.map((m) => m.toolName))].join(', ')}`,
      );

      // Group mutations by type
      const counts = new Map<string, number>();
      for (const m of mutations) {
        counts.set(m.toolName, (counts.get(m.toolName) || 0) + 1);
      }

      const titleStr = pageTitle ? `"${pageTitle}"` : '(unknown title)';
      const lines: string[] = [
        `[Editor Session] Page ${titleStr} (room: ${editorRoomId})`,
        `User request: "${userQuery}"`,
        '',
        `Operations performed (${mutations.length} total):`,
      ];

      for (const [toolName, count] of counts) {
        const label = toolName.replace(/_/g, ' ');
        lines.push(`- ${label}: ${count} operation(s)`);
      }

      // Add full mutation details
      const detailLines: string[] = [];
      for (const m of mutations) {
        detailLines.push(`  [${m.toolName}]: ${m.result}`);
      }
      if (detailLines.length > 0) {
        lines.push('', 'Mutation details:');
        lines.push(...detailLines);
      }

      await sendToMemoryEngine(auth, [
        {
          content: lines.join('\n'),
          role: 'assistant',
          role_type: 'assistant',
          name: 'Page Operation Tracker',
          source_description: 'page-operation-tracker',
        },
      ]);
    } catch (e) {
      Logger.warn(`[PageMemory] Failed to log editor session: ${e}`);
    }
  })();
}
