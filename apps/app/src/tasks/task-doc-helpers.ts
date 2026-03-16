/**
 * Shared helpers for working with task Y.Doc documents.
 *
 * Centralises the MatrixProviderManager lifecycle (init → use → dispose)
 * and the ServerBlockNoteEditor singleton so every call-site does not
 * duplicate the same boilerplate.
 */

import { ServerBlockNoteEditor } from '@blocknote/server-util';
import type * as Y from 'yjs';

import { BLOCKNOTE_TOOLS_CONFIG } from 'src/graph/agents/editor/blocknote-tools';
import type { AppConfig } from 'src/graph/agents/editor/config';
import { EditorMatrixClient } from 'src/graph/agents/editor/editor-mx';
import { MatrixProviderManager } from 'src/graph/agents/editor/provider';

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
