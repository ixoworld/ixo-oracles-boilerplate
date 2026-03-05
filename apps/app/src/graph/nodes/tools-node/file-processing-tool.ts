import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import path from 'node:path';
import z from 'zod';
import {
  type FileProcessingService,
  type SandboxUploadConfig,
} from 'src/messages/file-processing.service';

const logger = new Logger('process_file');

const COPY_TRUNCATE_LIMIT = 500;

/**
 * Creates a `process_file` LangGraph tool that lets the agent download and
 * extract content from a URL or Matrix event ID during its reasoning loop.
 *
 * All security (URI allowlist, 25 MB limit, magic bytes, timeouts) is
 * enforced by the underlying FileProcessingService.
 *
 * When `sandboxConfig` is provided, the tool supports `copy_to_sandbox`
 * which uploads the raw file to the sandbox via HTTP AND returns extracted
 * content (truncated if large).
 */
export function createFileProcessingTool(
  fileProcessingService: FileProcessingService,
  roomId?: string,
  sandboxConfig?: SandboxUploadConfig,
) {
  return tool(
    async ({
      url,
      eventId,
      filename,
      mimetype,
      copy_to_sandbox,
      sandbox_path,
    }) => {
      logger.log(
        `Tool invoked — url=${url ?? 'none'}, eventId=${eventId ?? 'none'}, filename=${filename ?? 'none'}, mimetype=${mimetype ?? 'none'}, copy_to_sandbox=${copy_to_sandbox ?? false}`,
      );
      try {
        // ── Shared validation ──
        const source = eventId ? { eventId, roomId } : url ? { url } : null;

        if (!source) {
          return '[Error: Either url or eventId must be provided.]';
        }

        if ('eventId' in source && !source.roomId) {
          return '[Error: Cannot process file by eventId — no Matrix room context available.]';
        }

        // ── Sandbox path: when sandbox is configured, always copy files there ──
        // copy_to_sandbox defaults to true when sandbox is available; set to false to skip
        const shouldCopyToSandbox = sandboxConfig && copy_to_sandbox !== false;

        if (copy_to_sandbox && !sandboxConfig) {
          return '[Error: copy_to_sandbox is not available — sandbox is not configured for this session.]';
        }

        if (shouldCopyToSandbox) {
          // Validate sandbox_path against path traversal
          if (sandbox_path) {
            const normalizedPath = path.posix.normalize(sandbox_path);
            if (
              !normalizedPath.startsWith('/workspace/') ||
              normalizedPath.includes('..')
            ) {
              return '[Error: sandbox_path must be under /workspace/ and cannot contain path traversal.]';
            }
          }

          const { buffer, text, resolvedFilename, resolvedMimetype } =
            await fileProcessingService.downloadAndProcessFile(source, {
              filename: filename ?? undefined,
              mimetype: mimetype ?? undefined,
            });

          // Determine sandbox destination path
          const destPath =
            sandbox_path ?? `/workspace/output/${resolvedFilename}`;

          // Upload to sandbox via HTTP
          let actualPath: string;
          try {
            const uploadResult = await fileProcessingService.uploadToSandbox(
              buffer,
              resolvedFilename,
              destPath,
              sandboxConfig,
              resolvedMimetype,
            );
            actualPath = uploadResult.path;
          } catch (writeError) {
            const msg =
              writeError instanceof Error
                ? writeError.message
                : String(writeError);
            logger.warn(`Sandbox upload failed: ${msg}`);
            return text + `\n\n[Warning: sandbox upload failed: ${msg}]`;
          }

          logger.log(
            `File uploaded to sandbox at ${actualPath} (${buffer.length} bytes)`,
          );

          // Return text with truncation if needed
          if (text.length > COPY_TRUNCATE_LIMIT) {
            return (
              text.slice(0, COPY_TRUNCATE_LIMIT) +
              `\n\n[Full file saved to sandbox at ${actualPath}]`
            );
          }
          return text + `\n\n[File also saved to sandbox at ${actualPath}]`;
        }

        // ── Standard path: process only, no sandbox copy ──
        let result: string;

        if (eventId) {
          result = await fileProcessingService.processFileFromEventId(
            roomId!,
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
        'Read a file and return its content as text. ' +
        'Works with public URLs, Matrix (mxc://) links, and Matrix event IDs. ' +
        'Documents (PDF, Word, text, HTML, CSV) are extracted as text. ' +
        'Images, audio, and video are described/transcribed by an AI model so you can understand what they contain. ' +
        'Use `eventId` (from list_room_files results) for files shared in the current Matrix room, or `url` for external files. ' +
        'When a sandbox is available, files are automatically saved to /workspace/output/{filename}. ' +
        'Use `sandbox_path` to override the destination. Set `copy_to_sandbox: false` to skip the sandbox copy. ' +
        'IMPORTANT: Do NOT call this tool for files the user just attached in their message — ' +
        'those are already pre-processed and their content (or a summary) is included in the conversation. ' +
        'If the message says "[File also saved to sandbox at ...]" or "[Full file saved to sandbox at ...]", ' +
        'the file is already available in the sandbox and its content is in context. ' +
        "Only use this tool for: files referenced by URL that you haven't seen yet, " +
        "files from list_room_files that weren't part of the current message, " +
        'or when you need to re-download a file to a different sandbox path.',
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
        copy_to_sandbox: z
          .boolean()
          .optional()
          .describe(
            'When sandbox is available, files are automatically copied there. ' +
              'Set to false to skip the sandbox copy. Defaults to true when sandbox is configured.',
          ),
        sandbox_path: z
          .string()
          .optional()
          .describe(
            'Destination path in the sandbox (e.g. "/workspace/output/data.csv"). Defaults to /workspace/output/{filename}.',
          ),
      }),
    },
  );
}
