import { tool } from '@langchain/core/tools';
import { EncryptedRoomEvent, MatrixManager } from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import z from 'zod';

const logger = new Logger('list_room_files');

const FILE_MSGTYPES = new Set(['m.file', 'm.image', 'm.video', 'm.audio']);
const MAX_PAGES = 5;
const EVENTS_PER_PAGE = 100;

interface RoomFileEntry {
  eventId: string;
  filename: string;
  mimetype: string;
  size?: number;
  sender: string;
  date: string;
  msgtype: string;
}

/**
 * Creates a `list_room_files` LangGraph tool that lists files/media
 * previously shared in the current Matrix room.
 *
 * Handles encrypted rooms by decrypting each event in-memory via
 * `crypto.decryptRoomEvent()` — no extra HTTP requests per event.
 */
export function createListRoomFilesTool(roomId: string) {
  return tool(
    async ({ limit, mediaType }) => {
      const maxResults = Math.min(limit ?? 50, 100);

      logger.log(
        `Tool invoked — roomId=${roomId}, limit=${maxResults}, mediaType=${mediaType ?? 'all'}`,
      );

      try {
        const client = MatrixManager.getInstance().getClient();
        if (!client) {
          return '[Error: Matrix client not available]';
        }

        const crypto = client.mxClient.crypto;
        const files: RoomFileEntry[] = [];
        let from: string | undefined;

        for (
          let page = 0;
          page < MAX_PAGES && files.length < maxResults;
          page++
        ) {
          const qs: Record<string, string | number> = {
            dir: 'b', // backwards (newest first)
            limit: EVENTS_PER_PAGE,
          };
          if (from) {
            qs.from = from;
          }

          const response = await client.mxClient.doRequest(
            'GET',
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
            qs,
          );

          const chunk = response.chunk as
            | Array<Record<string, unknown>>
            | undefined;
          if (!chunk || chunk.length === 0) {
            break;
          }

          for (const rawEvent of chunk) {
            if (files.length >= maxResults) break;

            const eventType = rawEvent.type as string;
            const sender = rawEvent.sender as string;
            const originTs = rawEvent.origin_server_ts as number;
            const eventId = rawEvent.event_id as string;

            let content: Record<string, unknown>;

            if (eventType === 'm.room.encrypted') {
              // Decrypt the event in-memory using the bot-sdk crypto
              if (!crypto) {
                logger.warn(
                  `Skipping encrypted event ${eventId} — crypto not available`,
                );
                continue;
              }
              try {
                const encrypted = new EncryptedRoomEvent(rawEvent);
                const decrypted = await crypto.decryptRoomEvent(
                  encrypted,
                  roomId,
                );
                content = (decrypted.content ?? {}) as Record<string, unknown>;
              } catch (err) {
                logger.debug(
                  `Could not decrypt event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
                );
                continue;
              }
            } else if (eventType === 'm.room.message') {
              content = (rawEvent.content ?? {}) as Record<string, unknown>;
            } else {
              continue;
            }

            const msgtype = content.msgtype as string | undefined;
            if (!msgtype || !FILE_MSGTYPES.has(msgtype)) {
              continue;
            }

            // Filter by media type if requested
            if (mediaType) {
              const expectedMsgtype = `m.${mediaType}`;
              if (msgtype !== expectedMsgtype) {
                continue;
              }
            }

            const info = (content.info ?? {}) as Record<string, unknown>;
            const entry: RoomFileEntry = {
              eventId,
              filename:
                (content.filename as string) ??
                (content.body as string) ??
                'unknown',
              mimetype: (info.mimetype as string) ?? 'application/octet-stream',
              size: info.size as number | undefined,
              sender,
              date: new Date(originTs ?? 0).toISOString(),
              msgtype,
            };

            files.push(entry);
          }

          from = response.end as string | undefined;
          if (!from) break;
        }

        if (files.length === 0) {
          return 'No files have been shared in this room.';
        }

        const result = JSON.stringify(files, null, 2);
        return (
          result +
          '\n\nTo read a file, use the process_file tool with the eventId from above.'
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Tool error: ${msg}`);
        return `[Error listing room files: ${msg}]`;
      }
    },
    {
      name: 'list_room_files',
      description:
        'List files and media (images, videos, audio, documents) that have been shared in the current Matrix room. ' +
        'Returns event IDs, filenames, types, and dates. ' +
        'Use the returned eventId with process_file to read a specific file.',
      schema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of files to return (default 50, max 100).'),
        mediaType: z
          .enum(['file', 'image', 'video', 'audio'])
          .optional()
          .describe('Filter by media type. Omit to list all types.'),
      }),
    },
  );
}
