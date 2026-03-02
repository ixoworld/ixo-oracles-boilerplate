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

type FileCategory = 'document' | 'image' | 'audio' | 'video' | 'unsupported';

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
  ): Promise<string[]> {
    const results: string[] = [];
    let totalDownloaded = 0;

    for (const attachment of attachments) {
      try {
        const { text, downloadedSize } = await this.processAttachment(
          attachment,
          totalDownloaded,
          roomId,
        );
        totalDownloaded += downloadedSize;
        if (text) {
          results.push(text);
        }
      } catch (error) {
        this.logger.error(
          `Failed to process attachment ${attachment.filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
        results.push(
          `[Failed to process ${this.sanitizeFilename(attachment.filename)}]`,
        );
      }
    }

    return results;
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
      buffer = await this.downloadFromUrl(attachment.mxcUri!);
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
      return { text: null, downloadedSize: buffer.length };
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
    const client = MatrixManager.getInstance().getClient();
    if (!client) {
      throw new Error('Matrix client not available');
    }

    const event = await client.mxClient.getEvent(roomId, eventId);
    if (!event.content) {
      throw new Error('Event has no content');
    }

    const isEncrypted = !!event.content.file;

    if (isEncrypted) {
      return client.mxClient.crypto.decryptMedia(event.content.file);
    } else {
      if (!event.content.url) {
        throw new Error('Event has no media URL');
      }
      const result = await client.mxClient.downloadContent(event.content.url);
      return result.data;
    }
  }

  private async downloadFromUrl(url: string): Promise<Buffer> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      MATRIX_DOWNLOAD_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
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
    const textMimes = ['text/plain', 'text/markdown', 'text/html'];
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
      mimetype === 'text/html'
    );
  }

  private async processDocument(
    buffer: Buffer,
    attachment: AttachmentDto,
  ): Promise<string> {
    const safeFilename = this.sanitizeFilename(attachment.filename);

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
    return filename
      .replace(/[\x00-\x1f\x7f]/g, '') // strip control chars
      .replace(/[\[\]]/g, '') // strip brackets to prevent [SYSTEM: ...] injection
      .slice(0, 255);
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
}
