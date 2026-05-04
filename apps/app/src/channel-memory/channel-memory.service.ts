import { MatrixManager } from '@ixo/matrix';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { type ENV } from '../types';
import { ChannelMemoryRepo } from './channel-memory.repo';
import { ChannelMemorySummarizer } from './channel-memory.summarizer';
import {
  type ChannelMember,
  type ChannelMemoryChunk,
  type ObservedMessage,
  type PinnedFact,
} from './channel-memory.types';

const logger = new Logger('ChannelMemoryService');

const COMPACT_BUFFER_THRESHOLD = 20;
const COMPACT_IDLE_MS = 5 * 60 * 1000;
const COMPACT_JIT_MIN = 5;
const COMPACT_JIT_TIMEOUT_MS = 3000;
const BUFFER_HARD_CAP = 40;
const SESSION_INJECT_RECENT_CHUNKS = 8;
const SESSION_INJECT_OLDEST_CHUNKS = 2;
const SESSION_INJECT_LAST_MESSAGES = 15;

interface BufferEntry {
  messages: ObservedMessage[];
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Channel memory pipeline.
 *
 * Owns:
 *   - In-memory rolling buffer of observed group messages (per room)
 *   - Append-only `channel_memory_chunks` SQLite table (via repo)
 *   - LLM-driven compaction (via summarizer)
 *   - Pinned facts CRUD
 *   - Helpers for session-start context injection
 *
 * Compaction is triggered when:
 *   - Buffer reaches COMPACT_BUFFER_THRESHOLD, or
 *   - COMPACT_IDLE_MS elapses with no new messages in the buffer, or
 *   - just-in-time when the agent is about to be engaged (`compactJustInTime`).
 *
 * Lost buffer on restart is acceptable — Matrix retains the raw messages and
 * the next compaction will pick up where we left off.
 */
@Injectable()
export class ChannelMemoryService implements OnModuleInit, OnModuleDestroy {
  private static singleton: ChannelMemoryService | undefined;

  private repo!: ChannelMemoryRepo;
  private readonly summarizer = new ChannelMemorySummarizer();
  private readonly buffer = new Map<string, BufferEntry>();
  /** Per-room compaction promise to serialize concurrent triggers. */
  private readonly compactionInFlight = new Map<string, Promise<void>>();

  constructor(private readonly config: ConfigService<ENV>) {}

  /**
   * Cross-cutting access — graph-layer code (createMainAgent, tools) needs
   * the service without going through Nest DI. Set during onModuleInit.
   */
  static getInstance(): ChannelMemoryService | undefined {
    return ChannelMemoryService.singleton;
  }

  onModuleInit(): void {
    const dir = this.config.getOrThrow<string>('SQLITE_DATABASE_PATH');
    const dbPath = path.join(dir, 'channel_memory.db');
    this.repo = new ChannelMemoryRepo(dbPath);
    ChannelMemoryService.singleton = this;
    logger.log(`[ChannelMemory] DB ready at ${dbPath}`);
  }

  onModuleDestroy(): void {
    for (const entry of this.buffer.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
    }
    this.buffer.clear();
    this.repo?.close();
    if (ChannelMemoryService.singleton === this) {
      ChannelMemoryService.singleton = undefined;
    }
  }

  /**
   * Append a group-room message to the rolling buffer. Always non-blocking,
   * always best-effort. Caller invokes this BEFORE gating so we capture
   * messages the bot ignored too.
   */
  observeMessage(roomId: string, message: ObservedMessage): void {
    let entry = this.buffer.get(roomId);
    if (!entry) {
      entry = { messages: [], idleTimer: null };
      this.buffer.set(roomId, entry);
    }
    entry.messages.push(message);

    // Reset idle timer
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.compact(roomId).catch((err) =>
        logger.warn(
          `[ChannelMemory] idle compaction failed for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }, COMPACT_IDLE_MS);

    if (entry.messages.length >= COMPACT_BUFFER_THRESHOLD) {
      void this.compact(roomId).catch((err) =>
        logger.warn(
          `[ChannelMemory] threshold compaction failed for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } else if (entry.messages.length >= BUFFER_HARD_CAP) {
      // Defensive: should never happen because threshold fires first
      void this.compact(roomId);
    }
  }

  /**
   * Run a compaction synchronously with a timeout. Used right before the agent
   * runs so the injected context reflects all unsummarized messages.
   * Best-effort: timeout simply skips and returns; chunk gets generated later
   * via the idle timer.
   */
  async compactJustInTime(roomId: string): Promise<void> {
    const entry = this.buffer.get(roomId);
    if (!entry || entry.messages.length < COMPACT_JIT_MIN) return;

    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, COMPACT_JIT_TIMEOUT_MS),
    );
    await Promise.race([this.compact(roomId), timeout]).catch((err) =>
      logger.warn(
        `[ChannelMemory] JIT compaction error for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /**
   * Drain the buffer for a room and produce a summary chunk. Serialized per
   * room — overlapping triggers wait on the in-flight promise.
   */
  private async compact(roomId: string): Promise<void> {
    const inFlight = this.compactionInFlight.get(roomId);
    if (inFlight) return inFlight;

    const promise = this.compactInner(roomId).finally(() => {
      this.compactionInFlight.delete(roomId);
    });
    this.compactionInFlight.set(roomId, promise);
    return promise;
  }

  private async compactInner(roomId: string): Promise<void> {
    const entry = this.buffer.get(roomId);
    if (!entry || entry.messages.length === 0) return;

    // Snapshot the buffer atomically; new messages start a fresh entry
    const drained = entry.messages.slice();
    entry.messages.length = 0;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    const summary = await this.summarizer.summarize(drained);
    if (!summary) {
      // Push messages back at the front so a later trigger retries
      entry.messages.unshift(...drained);
      logger.warn(
        `[ChannelMemory] summary unavailable; ${drained.length} msgs requeued for ${roomId}`,
      );
      return;
    }

    const chunk: ChannelMemoryChunk = {
      id: crypto.randomUUID(),
      roomId,
      summary,
      fromEventId: drained[0].eventId,
      toEventId: drained[drained.length - 1].eventId,
      fromTimestamp: drained[0].timestamp,
      toTimestamp: drained[drained.length - 1].timestamp,
      messageCount: drained.length,
      participants: Array.from(new Set(drained.map((m) => m.senderDid))),
      threadIds: Array.from(new Set(drained.map((m) => m.threadId))),
      tier: 1,
      createdAt: Date.now(),
    };

    try {
      this.repo.insertChunk(chunk);
      logger.log(
        `[ChannelMemory] room=${roomId} chunk=${chunk.id} msgs=${chunk.messageCount} totalChunks=${this.repo.countChunks(roomId)}`,
      );
    } catch (err) {
      logger.error(
        `[ChannelMemory] insertChunk failed for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Read APIs (used by tools and session-start injection) ───────────────

  recentChunks(
    roomId: string,
    limit = SESSION_INJECT_RECENT_CHUNKS,
  ): ChannelMemoryChunk[] {
    return this.repo.recentChunks(roomId, limit);
  }

  oldestChunks(
    roomId: string,
    limit = SESSION_INJECT_OLDEST_CHUNKS,
  ): ChannelMemoryChunk[] {
    return this.repo.oldestChunks(roomId, limit);
  }

  search(roomId: string, query: string, limit = 10): ChannelMemoryChunk[] {
    return this.repo.searchChunks(roomId, query, limit);
  }

  listPinnedFacts(roomId: string): PinnedFact[] {
    return this.repo.listPinnedFacts(roomId);
  }

  pinFact(args: {
    roomId: string;
    fact: string;
    pinnedByDid: string;
    sourceEventId?: string;
  }): PinnedFact {
    const fact: PinnedFact = {
      id: crypto.randomUUID(),
      roomId: args.roomId,
      fact: args.fact,
      pinnedByDid: args.pinnedByDid,
      sourceEventId: args.sourceEventId,
      createdAt: Date.now(),
    };
    this.repo.insertPinnedFact(fact);
    return fact;
  }

  unpinFact(roomId: string, factId: string): boolean {
    return this.repo.deletePinnedFact(roomId, factId);
  }

  getMembers(roomId: string): ChannelMember[] {
    return this.repo.getMembers(roomId);
  }

  /**
   * Refresh the cached member roster for a room from Matrix. Call on session
   * start. Best-effort — failures are logged and the cached roster is reused.
   */
  async refreshMembers(
    roomId: string,
    matrixManager: MatrixManager,
  ): Promise<ChannelMember[]> {
    try {
      const info = await matrixManager.getRoomInfo(roomId);
      const botUserId = matrixManager.getBotMatrixUserId();
      const members: ChannelMember[] = [];
      for (const userId of info.joinedMemberIds) {
        if (userId === botUserId) continue;
        const displayName = await matrixManager.getCachedDisplayName(
          userId,
          roomId,
        );
        members.push({ matrixUserId: userId, displayName });
      }
      this.repo.upsertMembers(roomId, members);
      return members;
    } catch (err) {
      logger.warn(
        `[ChannelMemory] refreshMembers failed for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.repo.getMembers(roomId);
    }
  }

  /**
   * Build the system-prompt-ready context block injected at the start of a
   * group-room session. Combines:
   *   - Member roster
   *   - Pinned facts
   *   - Last N recent chunks (recency)
   *   - Oldest few chunks (anchoring)
   *   - Last K raw room messages for immediate freshness
   */
  async buildSessionContext(
    roomId: string,
    matrixManager: MatrixManager,
  ): Promise<string> {
    const [members, recent, oldest, facts, recentMsgs] = await Promise.all([
      this.refreshMembers(roomId, matrixManager),
      Promise.resolve(this.recentChunks(roomId)),
      Promise.resolve(this.oldestChunks(roomId)),
      Promise.resolve(this.listPinnedFacts(roomId)),
      matrixManager
        .getRecentRoomMessages(roomId, { limit: SESSION_INJECT_LAST_MESSAGES })
        .catch((err) => {
          logger.warn(
            `[ChannelMemory] live recent fetch failed for ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [] as Awaited<
            ReturnType<typeof matrixManager.getRecentRoomMessages>
          >;
        }),
    ]);

    const sections: string[] = [];

    sections.push(
      `You are participating in a Matrix group chat. User messages are prefixed with "[DisplayName]:" so you know who is speaking. Address users by their display name when relevant. Stay quiet unless explicitly mentioned, replied to, or already in an active thread with you.`,
    );

    if (members.length > 0) {
      const lines = members
        .map((m) => `- ${m.displayName} (${m.matrixUserId})`)
        .join('\n');
      sections.push(`## Members in this room\n${lines}`);
    }

    if (facts.length > 0) {
      const lines = facts.map((f) => `- ${f.fact}`).join('\n');
      sections.push(`## Pinned facts\n${lines}`);
    }

    // Combine oldest + recent without duplicates, oldest first then recent
    const seen = new Set<string>();
    const ordered: ChannelMemoryChunk[] = [];
    for (const c of oldest) {
      if (!seen.has(c.id)) {
        ordered.push(c);
        seen.add(c.id);
      }
    }
    for (const c of recent) {
      if (!seen.has(c.id)) {
        ordered.push(c);
        seen.add(c.id);
      }
    }

    if (ordered.length > 0) {
      const lines = ordered
        .map((c) => {
          const when = new Date(c.toTimestamp).toISOString();
          return `### [${when}] ${c.messageCount} msgs\n${c.summary}`;
        })
        .join('\n\n');
      sections.push(`## Channel memory\n${lines}`);
    }

    if (recentMsgs.length > 0) {
      const lines = await Promise.all(
        recentMsgs.map(async (m) => {
          const dn = await matrixManager
            .getCachedDisplayName(m.sender, roomId)
            .catch(() => m.sender);
          const when = new Date(m.timestamp).toISOString();
          const thread = m.threadId ? ` thread=${m.threadId.slice(0, 10)}` : '';
          return `[${dn} @ ${when}${thread}]: ${m.body}`;
        }),
      );
      sections.push(`## Recent messages (verbatim)\n${lines.join('\n')}`);
    }

    sections.push(
      `Tools available for this room: search_channel_memory, recall_channel_memory, get_room_messages_range, pin_room_fact, unpin_room_fact.`,
    );

    return sections.join('\n\n');
  }
}
