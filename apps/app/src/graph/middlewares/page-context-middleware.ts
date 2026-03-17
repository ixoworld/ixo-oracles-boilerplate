import { MatrixManager } from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import { type AgentMiddleware, createMiddleware } from 'langchain';
import z from 'zod';

async function resolvePageTitle(roomId: string): Promise<string | undefined> {
  try {
    const client = MatrixManager.getInstance().getClient();
    if (!client) return undefined;
    const ev = await client.mxClient.getRoomStateEvent(
      roomId,
      'm.room.name',
      '',
    );
    return (ev as { name?: string })?.name ?? undefined;
  } catch {
    return undefined;
  }
}

function formatLabel(title: string | undefined, roomId: string): string {
  return title ? `"${title}" (${roomId})` : roomId;
}

export const createPageContextMiddleware = (): AgentMiddleware => {
  return createMiddleware({
    name: 'PageContextMiddleware',
    stateSchema: z.object({
      editorRoomId: z.string().optional(),
      _previousEditorRoomId: z.string().optional(),
    }),
    wrapModelCall: async (request, handler) => {
      const currentEditorRoomId = request.state.editorRoomId;
      Logger.log(
        `[PageContextMiddleware] wrapModelCall called, editorRoomId: ${currentEditorRoomId}`,
      );

      if (!currentEditorRoomId) {
        Logger.log('[PageContextMiddleware] No editorRoomId, passing through.');
        return handler(request);
      }

      Logger.log('[PageContextMiddleware] Resolving current page title...');
      const currentTitle = await resolvePageTitle(currentEditorRoomId);
      Logger.log(
        `[PageContextMiddleware] Current page title: ${currentTitle ?? '(none)'}`,
      );
      const currentLabel = formatLabel(currentTitle, currentEditorRoomId);

      const previousEditorRoomId = request.state._previousEditorRoomId;
      Logger.log(
        `[PageContextMiddleware] Previous editorRoomId: ${previousEditorRoomId ?? '(none)'}`,
      );
      let pageContext: string;

      if (
        previousEditorRoomId &&
        previousEditorRoomId !== currentEditorRoomId
      ) {
        Logger.log(
          `[PageContextMiddleware] Page switch detected: ${previousEditorRoomId} → ${currentEditorRoomId}`,
        );
        const previousTitle = await resolvePageTitle(previousEditorRoomId);
        Logger.log(
          `[PageContextMiddleware] Previous page title: ${previousTitle ?? '(none)'}`,
        );
        const previousLabel = formatLabel(previousTitle, previousEditorRoomId);

        pageContext =
          `\n\n## 📄 Active Page Context\n\n` +
          `The user has switched pages. Current page: ${currentLabel}. ` +
          `Previous page: ${previousLabel}. ` +
          `Previous page context in conversation history may be stale. ` +
          `Always favour the current active page. ` +
          `Before making any edits, use read_page to confirm the current page content ` +
          `and verify it matches what the user is asking you to work on. ` +
          `If the content differs from what was discussed, confirm with the user before editing.`;
      } else {
        Logger.log(
          '[PageContextMiddleware] No page switch. Injecting current page context.',
        );
        pageContext =
          `\n\n## 📄 Active Page Context\n\n` +
          `Current active page: ${currentLabel}. Always work with this page.`;
      }

      Logger.log(
        '[PageContextMiddleware] Appending page context to system message.',
      );
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(pageContext),
      });
    },
    afterModel: (state) => {
      if (
        state.editorRoomId &&
        state.editorRoomId !== state._previousEditorRoomId
      ) {
        Logger.log(
          `[PageContextMiddleware] Updating _previousEditorRoomId: ${state._previousEditorRoomId ?? '(none)'} → ${state.editorRoomId}`,
        );
        return { _previousEditorRoomId: state.editorRoomId };
      }
      return;
    },
  });
};
