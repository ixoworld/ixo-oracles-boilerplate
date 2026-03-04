import { loadFileFromBuffer } from '@ixo/common';
import { MatrixManager } from '@ixo/matrix';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { type AttachmentDto } from './dto/send-message.dto';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total across all attachments
const MAX_TEXT_LENGTH = 50_000;
const DEFAULT_FILE_PROCESSING_MODEL = 'google/gemini-2.5-flash-lite';
const MATRIX_DOWNLOAD_TIMEOUT_MS = 60_000; // 60s
const AI_PROCESS_TIMEOUT_MS = 120_000; // 120s
const MAX_ERROR_BODY_LENGTH = 1024; // Cap error response bodies

const ALLOWED_URI_SCHEMES = /^(mxc|https?):\/\//i;
const MAX_REDIRECT_COUNT = 5;

/**
 * Block list for SSRF protection.
 * Prevents redirects to internal/cloud metadata endpoints.
 */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // AWS/cloud metadata
  /^0\.0\.0\.0$/,
  /^\[::1?\]$/, // IPv6 loopback
  /^metadata\.google\.internal$/i,
];

/**
 * Magic byte signatures for common file types.
 * Maps a detected mimetype to the byte signature(s) that identify it.
 */
const MAGIC_BYTES: Array<{
  bytes: number[];
  offset?: number;
  mime: string;
}> = [
  // Images
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF (WebP container)
  // Documents
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip' }, // ZIP (docx, xlsx, etc.)
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], mime: 'application/msword' }, // OLE2 (doc, xls, ppt)
  // Audio
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // ID3 tag (MP3)
  { bytes: [0xff, 0xfb], mime: 'audio/mpeg' }, // MP3 frame sync
  { bytes: [0xff, 0xf3], mime: 'audio/mpeg' }, // MP3 frame sync
  { bytes: [0x4f, 0x67, 0x67, 0x53], mime: 'audio/ogg' }, // OGG
  { bytes: [0x66, 0x4c, 0x61, 0x43], mime: 'audio/flac' }, // fLaC
  // Video
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], mime: 'video/webm' }, // WebM/MKV (EBML)
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4' }, // MP4/MOV (ftyp box, 4th byte varies)
];

/**
 * Category groupings for magic byte matching.
 * Maps a detected magic mime to the broad categories it's compatible with.
 */
const MAGIC_MIME_CATEGORIES: Record<string, FileCategory[]> = {
  'image/png': ['image'],
  'image/jpeg': ['image'],
  'image/gif': ['image'],
  'image/webp': ['image'],
  'application/pdf': ['document'],
  'application/zip': ['document'], // docx/xlsx are ZIP archives
  'application/msword': ['document'],
  'audio/mpeg': ['audio'],
  'audio/ogg': ['audio'],
  'audio/flac': ['audio'],
  'video/webm': ['video', 'audio'], // WebM can be audio-only
  'video/mp4': ['video', 'audio'], // MP4 can be audio-only (m4a)
};

export type FileCategory =
  | 'document'
  | 'image'
  | 'audio'
  | 'video'
  | 'unsupported';

export interface ProcessedAttachment {
  filename: string;
  mimetype: string;
  size?: number;
  mxcUri?: string;
  eventId?: string;
  category: Exclude<FileCategory, 'unsupported'>;
}

const PROMPTS: Record<Exclude<FileCategory, 'unsupported'>, string> = {
  document: 'Extract all text content from this document verbatim.',
  image:
    'Describe this image in detail. Include all text, numbers, labels, and visual elements.',
  audio: 'Transcribe this audio completely. Include all spoken words.',
  video:
    'Describe this video in detail. Include actions, text overlays, and spoken content.',
};

@Injectable()
export class FileProcessingService {
  private readonly logger = new Logger(FileProcessingService.name);
  private readonly openRouterApiKey: string;
  private readonly processingModel: string;

  constructor(private readonly config: ConfigService<ENV>) {
    this.openRouterApiKey = this.config.getOrThrow('OPEN_ROUTER_API_KEY');
    this.processingModel = DEFAULT_FILE_PROCESSING_MODEL;
  }

  async processAttachments(
    attachments: AttachmentDto[],
    roomId: string,
  ): Promise<{ texts: string[]; metadata: ProcessedAttachment[] }> {
    const texts: string[] = [];
    const metadata: ProcessedAttachment[] = [];
    let totalDownloaded = 0;

    this.logger.log(
      `Processing ${attachments.length} attachment(s) in room ${roomId}`,
    );

    for (const attachment of attachments) {
      this.logger.log(
        `Attachment: "${attachment.filename}" (${attachment.mimetype}, ${attachment.size ?? 'unknown'} bytes) — source: ${attachment.eventId ? `eventId=${attachment.eventId}` : `mxcUri=${attachment.mxcUri}`}`,
      );
      try {
        const { text, downloadedSize } = await this.processAttachment(
          attachment,
          totalDownloaded,
          roomId,
        );
        totalDownloaded += downloadedSize;
        this.logger.log(
          `Attachment "${attachment.filename}" processed — downloaded ${downloadedSize} bytes, text extracted: ${text ? text.length + ' chars' : 'none'}`,
        );
        if (text) {
          const category = this.categorizeFile(attachment.mimetype);
          texts.push(text);
          metadata.push({
            filename: attachment.filename,
            mimetype: attachment.mimetype,
            size: attachment.size,
            mxcUri: attachment.mxcUri,
            eventId: attachment.eventId,
            category: category === 'unsupported' ? 'document' : category,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to process attachment ${attachment.filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
        const errorText = `[File "${this.sanitizeFilename(attachment.filename)}" (${attachment.mimetype}) failed to process: ${error instanceof Error ? error.message : 'unknown error'}. Let the user know this file could not be read.]`;
        const category = this.categorizeFile(attachment.mimetype);
        texts.push(errorText);
        metadata.push({
          filename: attachment.filename,
          mimetype: attachment.mimetype,
          size: attachment.size,
          mxcUri: attachment.mxcUri,
          eventId: attachment.eventId,
          category: category === 'unsupported' ? 'document' : category,
        });
      }
    }

    this.logger.log(
      `Attachments done — ${texts.length} text result(s), total downloaded: ${totalDownloaded} bytes`,
    );

    return { texts, metadata };
  }

  private async processAttachment(
    attachment: AttachmentDto,
    currentTotalSize: number,
    roomId: string,
  ): Promise<{ text: string | null; downloadedSize: number }> {
    // Validate that at least one source is provided
    if (!attachment.eventId && !attachment.mxcUri) {
      throw new Error('Either mxcUri or eventId must be provided');
    }

    // Validate URI scheme at runtime when mxcUri is present (defense-in-depth, DTO also validates)
    if (attachment.mxcUri && !ALLOWED_URI_SCHEMES.test(attachment.mxcUri)) {
      throw new Error('Invalid URI scheme');
    }

    // Validate file size from client-reported value
    if (attachment.size && attachment.size > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum size');
    }

    // Check total budget before downloading
    if (
      attachment.size &&
      currentTotalSize + attachment.size > MAX_TOTAL_SIZE
    ) {
      throw new Error('Total attachment size budget exceeded');
    }

    // Download from the appropriate source
    let buffer: Buffer;
    if (attachment.eventId) {
      buffer = await this.downloadFromMatrixEvent(roomId, attachment.eventId);
    } else if (attachment.mxcUri!.startsWith('mxc://')) {
      buffer = await this.downloadFromMatrix(attachment.mxcUri!);
    } else {
      const result = await this.downloadFromUrl(attachment.mxcUri!);
      buffer = result.data;
    }

    // Check actual downloaded size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum size');
    }

    // Check total budget after download
    if (currentTotalSize + buffer.length > MAX_TOTAL_SIZE) {
      throw new Error('Total attachment size budget exceeded');
    }

    const category = this.categorizeFile(attachment.mimetype);
    if (category === 'unsupported') {
      this.logger.warn(
        `Unsupported file type: ${attachment.mimetype} for ${attachment.filename}`,
      );
      return {
        text: `[File "${this.sanitizeFilename(attachment.filename)}" (${attachment.mimetype}) is not a supported file type and could not be processed. Let the user know this file type is not supported.]`,
        downloadedSize: buffer.length,
      };
    }

    // Verify magic bytes match claimed mimetype category
    this.verifyMagicBytes(buffer, category, attachment);

    let text: string;
    switch (category) {
      case 'document':
        text = await this.processDocument(buffer, attachment);
        break;
      case 'image':
        text = await this.processImage(buffer, attachment);
        break;
      case 'audio':
        text = await this.processAudio(buffer, attachment);
        break;
      case 'video':
        text = await this.processVideo(buffer, attachment);
        break;
    }

    return { text, downloadedSize: buffer.length };
  }

  private async downloadFromMatrix(mxcUri: string): Promise<Buffer> {
    const client = MatrixManager.getInstance().getClient();
    if (!client) {
      throw new Error('Matrix client not available');
    }

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      MATRIX_DOWNLOAD_TIMEOUT_MS,
    );

    try {
      const result = await client.mxClient.downloadContent(mxcUri);
      return result.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async downloadFromMatrixEvent(
    roomId: string,
    eventId: string,
  ): Promise<Buffer> {
    this.logger.log(`Fetching Matrix event ${eventId} from room ${roomId}`);
    const client = MatrixManager.getInstance().getClient();
    if (!client) {
      throw new Error('Matrix client not available');
    }

    const event = await client.mxClient.getEvent(roomId, eventId);
    if (!event.content) {
      throw new Error('Event has no content');
    }

    const isEncrypted = !!event.content.file;
    this.logger.log(
      `Event ${eventId} — encrypted: ${isEncrypted}, type: ${event.content.msgtype ?? event.type}`,
    );

    let data: Buffer;
    if (isEncrypted) {
      data = await client.mxClient.crypto.decryptMedia(event.content.file);
    } else {
      if (!event.content.url) {
        throw new Error('Event has no media URL');
      }
      const result = await client.mxClient.downloadContent(event.content.url);
      data = result.data;
    }

    this.logger.log(`Downloaded ${data.length} bytes from event ${eventId}`);
    return data;
  }

  /**
   * Validate that a URL does not point to an internal/private network address.
   * Prevents SSRF attacks via crafted or redirected URLs.
   */
  private validateUrlTarget(targetUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new Error('Invalid URL');
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname;
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new Error('URL points to a blocked internal address');
      }
    }
  }

  private async downloadFromUrl(
    url: string,
  ): Promise<{ data: Buffer; contentType?: string; finalUrl?: string }> {
    // Validate the initial URL against SSRF blocklist
    this.validateUrlTarget(url);

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      MATRIX_DOWNLOAD_TIMEOUT_MS,
    );

    try {
      // Follow redirects manually to validate each hop
      let currentUrl = url;
      let response: Response | undefined;

      for (let i = 0; i <= MAX_REDIRECT_COUNT; i++) {
        response = await fetch(currentUrl, {
          signal: abortController.signal,
          redirect: 'manual',
        });

        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.get('location')
        ) {
          const location = response.headers.get('location')!;
          // Resolve relative redirects
          currentUrl = new URL(location, currentUrl).toString();
          // Validate the redirect target
          this.validateUrlTarget(currentUrl);
          this.logger.debug(
            `[downloadFromUrl] Redirect ${i + 1} → ${currentUrl}`,
          );
          continue;
        }

        break;
      }

      if (!response || (response.status >= 300 && response.status < 400)) {
        throw new Error('Too many redirects');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading ${url}`);
      }

      const contentType =
        response.headers.get('content-type')?.split(';')[0]?.trim() ??
        undefined;

      // Check Content-Length header early to reject obviously oversized files
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        throw new Error(
          `File too large: server reports ${Math.round(parseInt(contentLength, 10) / 1024 / 1024)} MB (limit: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB)`,
        );
      }

      // Stream the body with a running size check to avoid OOM
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_FILE_SIZE) {
          void reader.cancel();
          throw new Error(
            `File exceeds maximum size (${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB) — download aborted`,
          );
        }
        chunks.push(value);
      }

      const finalUrl = currentUrl !== url ? currentUrl : undefined;

      return {
        data: Buffer.concat(chunks),
        contentType,
        finalUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Perform a HEAD request to determine Content-Type and Content-Length
   * without downloading the body. Follows redirects with SSRF validation.
   */
  private async headUrl(url: string): Promise<{
    contentType?: string;
    contentLength?: number;
    finalUrl: string;
  }> {
    this.validateUrlTarget(url);

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      MATRIX_DOWNLOAD_TIMEOUT_MS,
    );

    try {
      let currentUrl = url;
      let response: Response | undefined;

      for (let i = 0; i <= MAX_REDIRECT_COUNT; i++) {
        response = await fetch(currentUrl, {
          method: 'HEAD',
          signal: abortController.signal,
          redirect: 'manual',
        });

        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.get('location')
        ) {
          const location = response.headers.get('location')!;
          currentUrl = new URL(location, currentUrl).toString();
          this.validateUrlTarget(currentUrl);
          continue;
        }

        break;
      }

      if (!response || (response.status >= 300 && response.status < 400)) {
        throw new Error('Too many redirects');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from HEAD ${url}`);
      }

      const contentType =
        response.headers.get('content-type')?.split(';')[0]?.trim() ??
        undefined;
      const clHeader = response.headers.get('content-length');
      const contentLength = clHeader ? parseInt(clHeader, 10) : undefined;

      return { contentType, contentLength, finalUrl: currentUrl };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Detect the actual MIME type from the file's magic bytes.
   * Returns null if no known signature matches.
   */
  private detectMimeFromMagicBytes(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    for (const sig of MAGIC_BYTES) {
      const offset = sig.offset ?? 0;
      if (buffer.length < offset + sig.bytes.length) continue;

      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return sig.mime;
    }

    return null;
  }

  /**
   * Verify that the file's magic bytes are consistent with the claimed
   * mimetype category. For binary formats (images, audio, video, PDF)
   * this is strict. For text-based formats (text/plain, text/html, etc.)
   * we skip magic byte checks since they don't have reliable signatures.
   */
  private verifyMagicBytes(
    buffer: Buffer,
    claimedCategory: FileCategory,
    attachment: AttachmentDto,
  ): void {
    // Text-based document types don't have magic bytes — skip check
    const textMimes = ['text/plain', 'text/markdown', 'text/html', 'text/csv'];
    if (textMimes.includes(attachment.mimetype)) {
      return;
    }

    const detectedMime = this.detectMimeFromMagicBytes(buffer);

    // If we can't detect the mime, log a warning but allow processing
    // (covers less common formats without known signatures)
    if (!detectedMime) {
      this.logger.warn(
        `No magic bytes match for ${attachment.filename} (claimed: ${attachment.mimetype})`,
      );
      return;
    }

    const allowedCategories = MAGIC_MIME_CATEGORIES[detectedMime];
    if (!allowedCategories || !allowedCategories.includes(claimedCategory)) {
      throw new Error(
        `File content mismatch: claimed ${attachment.mimetype} but detected ${detectedMime}`,
      );
    }
  }

  private categorizeFile(mimetype: string): FileCategory {
    if (this.isDocumentType(mimetype)) return 'document';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('video/')) return 'video';
    return 'unsupported';
  }

  private isDocumentType(mimetype: string): boolean {
    return (
      mimetype === 'application/pdf' ||
      mimetype === 'application/msword' ||
      mimetype.startsWith(
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      ) ||
      mimetype === 'text/plain' ||
      mimetype === 'text/markdown' ||
      mimetype === 'text/html' ||
      mimetype === 'text/csv'
    );
  }

  private async processDocument(
    buffer: Buffer,
    attachment: AttachmentDto,
  ): Promise<string> {
    const safeFilename = this.sanitizeFilename(attachment.filename);

    // CSV is plain text — parse directly, no AI needed
    if (attachment.mimetype === 'text/csv') {
      const text = buffer.toString('utf-8');
      return this.formatContent(
        'Content',
        safeFilename,
        this.truncateText(text),
      );
    }

    // Try local parsing first (free)
    try {
      const docs = await loadFileFromBuffer(
        buffer,
        attachment.mimetype,
        attachment.filename,
      );
      const text = docs.map((doc) => doc.pageContent).join('\n\n');
      if (text.trim().length > 0) {
        return this.formatContent(
          'Content',
          safeFilename,
          this.truncateText(text),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Local parsing failed for ${attachment.filename}, falling back to AI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fallback: send to AI model for extraction
    const description = await this.aiProcess(
      buffer,
      attachment.mimetype,
      'document',
      attachment.filename,
    );
    return this.formatContent('Content', safeFilename, description);
  }

  private async processImage(
    buffer: Buffer,
    attachment: AttachmentDto,
  ): Promise<string> {
    const description = await this.aiProcess(
      buffer,
      attachment.mimetype,
      'image',
      attachment.filename,
    );
    return this.formatContent(
      'Description',
      this.sanitizeFilename(attachment.filename),
      description,
    );
  }

  private async processAudio(
    buffer: Buffer,
    attachment: AttachmentDto,
  ): Promise<string> {
    const transcription = await this.aiProcess(
      buffer,
      attachment.mimetype,
      'audio',
      attachment.filename,
    );
    return this.formatContent(
      'Transcription',
      this.sanitizeFilename(attachment.filename),
      transcription,
    );
  }

  private async processVideo(
    buffer: Buffer,
    attachment: AttachmentDto,
  ): Promise<string> {
    const description = await this.aiProcess(
      buffer,
      attachment.mimetype,
      'video',
      attachment.filename,
    );
    return this.formatContent(
      'Description',
      this.sanitizeFilename(attachment.filename),
      description,
    );
  }

  /**
   * Send a public URL directly to OpenRouter for image/video processing
   * without downloading the file first. Faster and avoids OOM for large files.
   */
  private async aiProcessFromUrl(
    url: string,
    _mimetype: string,
    category: 'image' | 'video',
    _filename: string,
  ): Promise<string> {
    const prompt = PROMPTS[category];

    const contentParts: Record<string, unknown>[] = [
      { type: 'text', text: prompt },
    ];

    if (category === 'image') {
      contentParts.push({
        type: 'image_url',
        image_url: { url },
      });
    } else {
      contentParts.push({
        type: 'video_url',
        video_url: { url },
      });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      AI_PROCESS_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'oracle-app.com',
            'X-Title': this.config.get('ORACLE_NAME') ?? 'Oracle App',
          },
          body: JSON.stringify({
            model: this.processingModel,
            messages: [
              {
                role: 'user',
                content: contentParts,
              },
            ],
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `OpenRouter API error (${response.status}): ${errorText.slice(0, MAX_ERROR_BODY_LENGTH)}`,
        );
        throw new Error(`AI processing failed (${response.status})`);
      }

      const result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      return result.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async aiProcess(
    buffer: Buffer,
    mimetype: string,
    category: Exclude<FileCategory, 'unsupported'>,
    filename: string,
  ): Promise<string> {
    const base64 = buffer.toString('base64');
    const dataUri = `data:${mimetype};base64,${base64}`;
    const prompt = PROMPTS[category];

    const contentParts: Record<string, unknown>[] = [
      { type: 'text', text: prompt },
    ];

    if (category === 'image') {
      contentParts.push({
        type: 'image_url',
        image_url: { url: dataUri },
      });
    } else if (category === 'audio') {
      contentParts.push({
        type: 'input_audio',
        input_audio: { data: base64, format: this.getAudioFormat(mimetype) },
      });
    } else if (category === 'document') {
      contentParts.push({
        type: 'file',
        file: { filename, file_data: dataUri },
      });
    } else if (category === 'video') {
      contentParts.push({
        type: 'video_url',
        video_url: { url: dataUri },
      });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      AI_PROCESS_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'oracle-app.com',
            'X-Title': this.config.get('ORACLE_NAME') ?? 'Oracle App',
          },
          body: JSON.stringify({
            model: this.processingModel,
            messages: [
              {
                role: 'user',
                content: contentParts,
              },
            ],
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        // Log full error server-side, throw generic message
        this.logger.error(
          `OpenRouter API error (${response.status}): ${errorText.slice(0, MAX_ERROR_BODY_LENGTH)}`,
        );
        throw new Error(`AI processing failed (${response.status})`);
      }

      const result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      return result.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private getAudioFormat(
    mimetype: string,
  ): 'mp3' | 'wav' | 'ogg' | 'flac' | 'webm' {
    if (mimetype.includes('mp3') || mimetype.includes('mpeg')) return 'mp3';
    if (mimetype.includes('wav')) return 'wav';
    if (mimetype.includes('ogg')) return 'ogg';
    if (mimetype.includes('flac')) return 'flac';
    if (mimetype.includes('webm')) return 'webm';
    return 'mp3'; // default
  }

  /**
   * Strip control characters and bracket sequences from filename
   * to prevent prompt injection when interpolated into LLM context.
   */
  private sanitizeFilename(filename: string): string {
    return (
      filename
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/gu, '') // strip control chars
        .replace(/[[\]]/g, '') // strip brackets to prevent [SYSTEM: ...] injection
        .slice(0, 255)
    );
  }

  private formatContent(
    label: string,
    filename: string,
    content: string,
  ): string {
    return `[${label} of ${filename}]:\n${content}`;
  }

  private truncateText(text: string): string {
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return text.slice(0, MAX_TEXT_LENGTH) + '\n\n[...truncated]';
  }

  /**
   * Process a file from a Matrix event ID.
   * Downloads via downloadFromMatrixEvent (handles encrypted + unencrypted)
   * and routes through the standard processCategory pipeline.
   */
  async processFileFromEventId(
    roomId: string,
    eventId: string,
    hints?: { filename?: string; mimetype?: string },
  ): Promise<string> {
    this.logger.log(
      `[processFileFromEventId] Starting — roomId=${roomId}, eventId=${eventId}, hints=${JSON.stringify(hints)}`,
    );

    const buffer = await this.downloadFromMatrixEvent(roomId, eventId);

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum size (25 MB)');
    }

    const filename = hints?.filename ?? 'file';
    const magicMime = this.detectMimeFromMagicBytes(buffer);
    const extensionMime = this.guessMimeFromFilename(filename);
    const mimetype =
      hints?.mimetype ??
      extensionMime ??
      magicMime ??
      'application/octet-stream';

    this.logger.log(
      `[processFileFromEventId] Resolved — filename="${filename}", mimetype="${mimetype}" ` +
        `(hints=${hints?.mimetype}, extension=${extensionMime}, magic=${magicMime})`,
    );

    const category = this.categorizeFile(mimetype);

    if (category === 'unsupported') {
      // Try fallback from magic bytes
      const fallbackMime = magicMime;
      const fallbackCategory = fallbackMime
        ? this.categorizeFile(fallbackMime)
        : 'unsupported';

      if (fallbackCategory !== 'unsupported' && fallbackMime) {
        const attachment: AttachmentDto = { filename, mimetype: fallbackMime };
        this.verifyMagicBytes(buffer, fallbackCategory, attachment);
        return this.processCategory(buffer, fallbackCategory, attachment);
      }

      return `[File "${this.sanitizeFilename(filename)}" (${mimetype}) is not a supported file type and could not be processed.]`;
    }

    const attachment: AttachmentDto = { filename, mimetype };
    this.verifyMagicBytes(buffer, category, attachment);
    return this.processCategory(buffer, category, attachment);
  }

  /**
   * Process a file from a URL and extract its content as text.
   * For HTTPS image/video URLs, passes the URL directly to the AI model (no download).
   * For audio/documents/mxc, downloads first then processes locally or via AI.
   * If the type can't be determined, tries AI passthrough before falling back to download.
   */
  async processFileFromUrl(
    url: string,
    hints?: { filename?: string; mimetype?: string },
  ): Promise<string> {
    this.logger.log(
      `[processFileFromUrl] Starting — url=${url}, hints=${JSON.stringify(hints)}`,
    );

    // Validate URI scheme
    if (!ALLOWED_URI_SCHEMES.test(url)) {
      throw new Error(
        'Invalid URI scheme — only http, https, and mxc are allowed',
      );
    }

    // ── mxc:// — always download (private Matrix media, not accessible by AI) ──
    if (url.startsWith('mxc://')) {
      return this.downloadAndProcess(url, hints);
    }

    // ── HTTPS — try to determine type and route accordingly ──
    const filename = hints?.filename ?? this.extractFilenameFromUrl(url);
    const extensionMime = this.guessMimeFromFilename(filename);
    const knownMime = hints?.mimetype ?? extensionMime;
    const knownCategory = knownMime ? this.categorizeFile(knownMime) : null;

    // If we already know it's image/video from hints or extension, pass URL directly
    if (knownCategory === 'image' || knownCategory === 'video') {
      this.logger.log(
        `[processFileFromUrl] URL passthrough (${knownCategory}) — "${filename}" (${knownMime})`,
      );
      return this.tryUrlPassthrough(url, knownMime!, knownCategory, filename);
    }

    // If we already know it's audio/document, download directly (no HEAD needed)
    if (knownCategory === 'audio' || knownCategory === 'document') {
      this.logger.log(
        `[processFileFromUrl] Known ${knownCategory} — downloading "${filename}" (${knownMime})`,
      );
      return this.downloadAndProcess(url, hints);
    }

    // ── Unknown type — use HEAD to figure it out ──
    this.logger.log(
      `[processFileFromUrl] Unknown type for "${filename}" — trying HEAD`,
    );

    let headContentType: string | undefined;
    let resolvedUrl = url;
    try {
      const head = await this.headUrl(url);
      headContentType = head.contentType;
      resolvedUrl = head.finalUrl;
    } catch (error) {
      this.logger.warn(
        `[processFileFromUrl] HEAD failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (headContentType) {
      // Ignore text/html — web pages usually wrap embedded media (YouTube, etc.)
      // and should fall through to the AI video passthrough below.
      const isHtmlPage = headContentType.startsWith('text/html');
      const headCategory = isHtmlPage
        ? 'unsupported'
        : this.categorizeFile(headContentType);

      if (headCategory === 'image' || headCategory === 'video') {
        this.logger.log(
          `[processFileFromUrl] HEAD says ${headCategory} (${headContentType}) — URL passthrough`,
        );
        return this.tryUrlPassthrough(
          resolvedUrl,
          headContentType,
          headCategory,
          filename,
        );
      }

      if (headCategory === 'audio' || headCategory === 'document') {
        this.logger.log(
          `[processFileFromUrl] HEAD says ${headCategory} (${headContentType}) — downloading`,
        );
        return this.downloadAndProcess(url, hints);
      }
    }

    // ── Still unknown (e.g. text/html from YouTube, no Content-Type) ──
    // Try passing the URL to AI as video — Gemini natively handles YouTube,
    // Vimeo, and many other platforms that serve HTML pages with embedded video.
    this.logger.log(
      `[processFileFromUrl] Type still unknown (HEAD Content-Type: ${headContentType ?? 'none'}) — trying AI video passthrough as fallback`,
    );
    try {
      const description = await this.aiProcessFromUrl(
        resolvedUrl,
        'video/mp4',
        'video',
        filename,
      );
      // If the AI returned a meaningful response, use it
      if (description && description.trim().length > 0) {
        this.logger.log(
          `[processFileFromUrl] AI video passthrough succeeded for "${filename}"`,
        );
        return this.formatContent(
          'Description',
          this.sanitizeFilename(filename),
          description,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[processFileFromUrl] AI video passthrough failed, falling back to download: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // ── Last resort — download and process from bytes ──
    this.logger.log(
      `[processFileFromUrl] All passthrough attempts failed — downloading "${filename}"`,
    );
    return this.downloadAndProcess(url, hints);
  }

  /**
   * Try passing a URL directly to AI for image/video processing.
   * If the AI rejects it, falls back to download + process.
   */
  private async tryUrlPassthrough(
    url: string,
    mimetype: string,
    category: 'image' | 'video',
    filename: string,
  ): Promise<string> {
    try {
      const description = await this.aiProcessFromUrl(
        url,
        mimetype,
        category,
        filename,
      );
      if (description && description.trim().length > 0) {
        return this.formatContent(
          'Description',
          this.sanitizeFilename(filename),
          description,
        );
      }
      this.logger.warn(
        `[tryUrlPassthrough] AI returned empty response for "${filename}", falling back to download`,
      );
    } catch (error) {
      this.logger.warn(
        `[tryUrlPassthrough] AI passthrough failed for "${filename}", falling back to download: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return this.downloadAndProcess(url, { filename, mimetype });
  }

  /**
   * Download a URL (or mxc:// resource) into memory and process from the buffer.
   * Handles size validation, mime detection from bytes, and category routing.
   */
  private async downloadAndProcess(
    url: string,
    hints?: { filename?: string; mimetype?: string },
  ): Promise<string> {
    let buffer: Buffer;
    let httpContentType: string | undefined;
    let finalUrl: string | undefined;

    if (url.startsWith('mxc://')) {
      buffer = await this.downloadFromMatrix(url);
    } else {
      const result = await this.downloadFromUrl(url);
      buffer = result.data;
      httpContentType = result.contentType;
      finalUrl = result.finalUrl;
    }

    this.logger.log(
      `[downloadAndProcess] Downloaded ${buffer.length} bytes, HTTP Content-Type: ${httpContentType ?? 'none'}` +
        (finalUrl ? `, redirected to: ${finalUrl}` : ''),
    );

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum size (25 MB)');
    }

    const filename =
      hints?.filename ??
      (finalUrl ? this.extractFilenameFromUrl(finalUrl) : null) ??
      this.extractFilenameFromUrl(url);

    const extensionMime = this.guessMimeFromFilename(filename);
    const magicMime = this.detectMimeFromMagicBytes(buffer);
    const mimetype =
      hints?.mimetype ??
      extensionMime ??
      magicMime ??
      httpContentType ??
      'application/octet-stream';

    this.logger.log(
      `[downloadAndProcess] Resolved — filename="${filename}", mimetype="${mimetype}" ` +
        `(extension=${extensionMime}, magic=${magicMime}, http=${httpContentType})`,
    );

    const category = this.categorizeFile(mimetype);

    if (category === 'unsupported') {
      const fallbackMime = magicMime ?? httpContentType;
      const fallbackCategory = fallbackMime
        ? this.categorizeFile(fallbackMime)
        : 'unsupported';

      if (fallbackCategory !== 'unsupported' && fallbackMime) {
        this.logger.log(
          `[downloadAndProcess] Fallback mime "${fallbackMime}" → ${fallbackCategory}`,
        );
        const attachment: AttachmentDto = { filename, mimetype: fallbackMime };
        this.verifyMagicBytes(buffer, fallbackCategory, attachment);
        return this.processCategory(buffer, fallbackCategory, attachment);
      }

      this.logger.warn(
        `[downloadAndProcess] Unsupported file type: ${mimetype} for ${filename}`,
      );
      return `[File "${this.sanitizeFilename(filename)}" (${mimetype}) is not a supported file type and could not be processed.]`;
    }

    const attachment: AttachmentDto = { filename, mimetype };
    this.verifyMagicBytes(buffer, category, attachment);
    return this.processCategory(buffer, category, attachment);
  }

  /**
   * Route a validated buffer to the correct processor by category.
   */
  private async processCategory(
    buffer: Buffer,
    category: Exclude<FileCategory, 'unsupported'>,
    attachment: AttachmentDto,
  ): Promise<string> {
    this.logger.log(
      `[processCategory] Processing "${attachment.filename}" as ${category} (${attachment.mimetype}, ${buffer.length} bytes)`,
    );

    switch (category) {
      case 'document':
        return this.processDocument(buffer, attachment);
      case 'image':
        return this.processImage(buffer, attachment);
      case 'audio':
        return this.processAudio(buffer, attachment);
      case 'video':
        return this.processVideo(buffer, attachment);
    }
  }

  /**
   * Best-effort filename extraction from a URL path.
   * Falls back to 'download' if nothing useful can be derived.
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop();
      if (lastSegment) {
        return decodeURIComponent(lastSegment).slice(0, 255);
      }
    } catch {
      // Malformed URL — fall through
    }
    return 'download';
  }

  /**
   * Map common file extensions to MIME types.
   * Returns null if the extension is unknown.
   */
  private guessMimeFromFilename(filename: string): string | null {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const map: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      md: 'text/markdown',
      html: 'text/html',
      htm: 'text/html',
      csv: 'text/csv',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      wav: 'audio/wav',
      webm: 'video/webm',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
    };

    return map[ext] ?? null;
  }
}
