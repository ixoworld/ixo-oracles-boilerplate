/**
 * Shared helpers for working with task Y.Doc documents.
 *
 * Centralises the MatrixProviderManager lifecycle (init → use → dispose)
 * and the ServerBlockNoteEditor singleton so every call-site does not
 * duplicate the same boilerplate.
 */

import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { Logger } from '@nestjs/common';
import type * as Y from 'yjs';

import { BLOCKNOTE_TOOLS_CONFIG } from 'src/graph/agents/editor/blocknote-tools';
import type { AppConfig } from 'src/graph/agents/editor/config';
import { EditorMatrixClient } from 'src/graph/agents/editor/editor-mx';
import { MatrixProviderManager } from 'src/graph/agents/editor/provider';

import { appendOutputRow, readTaskMeta } from './task-doc';
import type { TaskMeta } from './task-meta';
import { formatOutputSection } from './task-page-template';
import {
  formatOutputDate,
  sanitizeSummary,
  truncateText,
  type WorkResult,
} from './processors/processor-utils';

// ── Shared ServerBlockNoteEditor singleton ──────────────────────────

/** Single editor instance shared across TasksService and processors. */
export const sharedServerEditor: ServerBlockNoteEditor =
  ServerBlockNoteEditor.create();

// ── Y.Doc lifecycle helper ──────────────────────────────────────────

/**
 * Open a task's Y.Doc, run a callback, then dispose the provider.
 *
 * Replaces the repeated pattern of:
 *   EditorMatrixClient.getInstance() → init → getClient → build config
 *   → new MatrixProviderManager → init → use doc → dispose
 *
 * @param roomId  Matrix room ID that backs the Y.Doc
 * @param fn      Callback that receives the Y.Doc — may be sync or async
 * @returns       Whatever `fn` returns
 */
export async function withTaskDoc<T>(
  roomId: string,
  fn: (doc: Y.Doc) => T | Promise<T>,
): Promise<T> {
  const editorClient = EditorMatrixClient.getInstance();
  await editorClient.init();
  const matrixClient = editorClient.getClient();

  const appConfig: AppConfig = {
    matrix: {
      ...BLOCKNOTE_TOOLS_CONFIG.matrix,
      room: { type: 'id', value: roomId },
    },
    provider: BLOCKNOTE_TOOLS_CONFIG.provider,
    blocknote: { mutableAttributeKeys: [] },
  };

  const providerManager = new MatrixProviderManager(matrixClient, appConfig);
  try {
    const { doc } = await providerManager.init();
    return await fn(doc);
  } finally {
    await providerManager.dispose();
  }
}

// ── Shared appendOutputToPage ────────────────────────────────────────

const appendOutputLogger = new Logger('appendOutputToPage');

/**
 * Append an output row to the task page Y.Doc and regenerate the
 * "Recent Output" table in the BlockNote document content.
 *
 * Shared between DeliverProcessor (direct delivery) and ApprovalService
 * (approved delivery) to avoid duplication.
 */
export async function appendOutputToPage(
  meta: TaskMeta,
  mainRoomId: string,
  workResult: WorkResult,
  messageEventId?: string,
): Promise<void> {
  const docRoomId = meta.customRoomId ?? mainRoomId;

  await withTaskDoc(docRoomId, async (doc) => {
    // 1. Append the new row to the Y.Map sidecar
    appendOutputRow(doc, {
      when: formatOutputDate(new Date(), meta.timezone),
      summary: truncateText(sanitizeSummary(workResult.result), 200),
      link: messageEventId ? `#msg-${messageEventId}` : '',
    });

    // 2. Regenerate the "Recent Output" table in the document
    const updatedMeta = readTaskMeta(doc);
    const tableMd = formatOutputSection(updatedMeta);
    const tableBlocks =
      await sharedServerEditor.tryParseMarkdownToBlocks(tableMd);

    const fragment = doc.getXmlFragment('document');
    const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);

    // Find the "Recent Output" heading
    const headingIdx = blocks.findIndex(
      (b) =>
        b.type === 'heading' &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((b.content as any)?.[0]?.text as string | undefined)
          ?.trim()
          .toLowerCase() === 'recent output',
    );

    if (headingIdx === -1) {
      appendOutputLogger.warn(
        `"Recent Output" heading not found in task page, skipping table update`,
      );
      return;
    }

    // Find the range after the heading until the next heading or end of doc
    const afterHeading = headingIdx + 1;
    let endIdx = blocks.length;
    for (let i = afterHeading; i < blocks.length; i++) {
      if (blocks[i].type === 'heading') {
        endIdx = i;
        break;
      }
    }

    // Rebuild: everything before table section + heading + new table blocks + rest
    const rebuilt = [
      ...blocks.slice(0, afterHeading),
      ...tableBlocks,
      ...blocks.slice(endIdx),
    ];

    // Replace document content
    doc.transact(() => {
      while (fragment.length > 0) {
        fragment.delete(0, 1);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sharedServerEditor.blocksToYXmlFragment(rebuilt as any, fragment);
    });
  });
}

// ── Rejection audit logging ──────────────────────────────────────────

const rejectionLogger = new Logger('appendRejectionToPage');

/**
 * Append a rejection entry to the task page's "Notes" section.
 * Creates an audit trail of user rejections directly on the page,
 * so both the agent and the user can see the history.
 */
export async function appendRejectionToPage(params: {
  meta: TaskMeta;
  mainRoomId: string;
  rejectionCount: number;
  rejectionReason: string;
  timezone?: string;
}): Promise<void> {
  const { meta, mainRoomId, rejectionCount, rejectionReason, timezone } =
    params;
  const docRoomId = meta.customRoomId ?? mainRoomId;

  const timestamp = formatOutputDate(new Date(), timezone ?? meta.timezone);
  const rejectionMd = [
    `#### Rejection #${rejectionCount} — ${timestamp}`,
    `Reason: ${rejectionReason}`,
    '',
  ].join('\n');

  await withTaskDoc(docRoomId, async (doc) => {
    const rejectionBlocks =
      await sharedServerEditor.tryParseMarkdownToBlocks(rejectionMd);

    const fragment = doc.getXmlFragment('document');
    const blocks = sharedServerEditor.yXmlFragmentToBlocks(fragment);

    // Find the "Notes" heading
    const notesIdx = blocks.findIndex(
      (b) =>
        b.type === 'heading' &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((b.content as any)?.[0]?.text as string | undefined)
          ?.trim()
          .toLowerCase() === 'notes',
    );

    if (notesIdx === -1) {
      rejectionLogger.warn(
        `"Notes" heading not found in task page, skipping rejection log`,
      );
      return;
    }

    // Find the end of the Notes section (next heading or end of doc)
    let insertIdx = blocks.length;
    for (let i = notesIdx + 1; i < blocks.length; i++) {
      if (blocks[i].type === 'heading') {
        insertIdx = i;
        break;
      }
    }

    // Insert rejection entry at the end of the Notes section
    const rebuilt = [
      ...blocks.slice(0, insertIdx),
      ...rejectionBlocks,
      ...blocks.slice(insertIdx),
    ];

    doc.transact(() => {
      while (fragment.length > 0) {
        fragment.delete(0, 1);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sharedServerEditor.blocksToYXmlFragment(rebuilt as any, fragment);
    });
  });
}
