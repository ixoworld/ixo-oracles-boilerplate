import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import z from 'zod';
import { type FileProcessingService } from 'src/messages/file-processing.service';

const logger = new Logger('process_file');

/**
 * Creates a `process_file` LangGraph tool that lets the agent download and
 * extract content from a URL or Matrix event ID during its reasoning loop.
 *
 * All security (URI allowlist, 25 MB limit, magic bytes, timeouts) is
 * enforced by the underlying FileProcessingService.
 */
export function createFileProcessingTool(
  fileProcessingService: FileProcessingService,
  roomId?: string,
) {
  return tool(
    async ({ url, eventId, filename, mimetype }) => {
      logger.log(
        `Tool invoked — url=${url ?? 'none'}, eventId=${eventId ?? 'none'}, filename=${filename ?? 'none'}, mimetype=${mimetype ?? 'none'}`,
      );
      try {
        let result: string;

        if (eventId) {
          if (!roomId) {
            return '[Error: Cannot process file by eventId — no Matrix room context available.]';
          }
          result = await fileProcessingService.processFileFromEventId(
            roomId,
            eventId,
            {
              filename: filename ?? undefined,
              mimetype: mimetype ?? undefined,
            },
          );
        } else if (url) {
          result = await fileProcessingService.processFileFromUrl(url, {
            filename: filename ?? undefined,
            mimetype: mimetype ?? undefined,
          });
        } else {
          return '[Error: Either url or eventId must be provided.]';
        }

        logger.log(
          `Tool success — ${eventId ? `eventId=${eventId}` : `url=${url}`}, result length=${result.length} chars`,
        );
        return result;
      } catch (error) {
        const source = eventId ? `eventId ${eventId}` : url;
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Tool error — ${source}: ${msg}`);
        return `[Error processing file from ${source}: ${msg}]`;
      }
    },
    {
      name: 'process_file',
      description:
        'Read any file and return its content as text. ' +
        'Works with public URLs, Matrix (mxc://) links, and Matrix event IDs. ' +
        'Documents (PDF, Word, text, HTML, CSV) are extracted as text. ' +
        'Images, audio, and video are described/transcribed by an AI model so you can understand what they contain. ' +
        'Use `eventId` (from list_room_files results) for files shared in the current Matrix room, or `url` for external files. ' +
        'ALWAYS use this tool when a user shares a file or you need to read a previously shared file.',
      schema: z.object({
        url: z
          .string()
          .url()
          .nullish()
          .describe(
            'Public HTTPS or mxc:// URL of the file to read. Required if eventId is not provided.',
          ),
        eventId: z
          .string()
          .nullish()
          .describe(
            'Matrix event ID (e.g. "$abc123") of a file shared in the current room. Required if url is not provided. Get this from list_room_files.',
          ),
        filename: z
          .string()
          .nullish()
          .describe(
            'Optional filename hint (e.g. "report.pdf"). Helps with MIME detection when the URL path is opaque.',
          ),
        mimetype: z
          .string()
          .nullish()
          .describe(
            'Optional MIME type hint (e.g. "application/pdf"). Overrides extension-based detection.',
          ),
      }),
    },
  );
}
