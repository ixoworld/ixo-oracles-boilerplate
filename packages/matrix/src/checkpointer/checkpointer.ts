import 'dotenv/config';

import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  maxChannelVersion,
} from '@langchain/langgraph-checkpoint';

import { Logger } from '@ixo/logger';

import { matrixStateManager } from '../matrix-state-manager/matrix-state-manager.js';
import type { IGraphStateWithRequiredFields } from './types.js';

// Storage interfaces - simplified like SQL
interface StoredCheckpoint {
  thread_id: string;
  checkpoint_id: string;
  checkpoint_ns: string;
  parent_checkpoint_id?: string;
  type: string;
  checkpoint: string; // serialized
  metadata: string; // serialized
  lastUpdatedAt?: number;
  sizeBytes?: number;
}

interface StoredWrite {
  thread_id: string;
  checkpoint_id: string;
  checkpoint_ns: string;
  task_id: string;
  idx: number;
  channel: string;
  type: string;
  value: string; // serialized
}

interface ThreadIndex {
  ids: string[];
  lastUpdatedAt: number;
  deleted?: boolean;
}

// LRU Cache implementation
class LRUCache<T> {
  private cache: Map<string, { value: T; timestamp: number }> = new Map();
  private readonly max: number;
  private readonly ttl: number;

  constructor(max: number = 5000, ttl: number = 30000) {
    this.max = max;
    this.ttl = ttl;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.max) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  deletePattern(pattern: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

// Cache metrics
interface CacheMetrics {
  hits: number;
  misses: number;
  indexRebuilds: number;
  filteredEvents: number;
  duplicateEvents: number;
}

// Promise deduplication map
class PromiseDeduplicator<T> {
  private pending = new Map<string, Promise<T>>();

  async dedupe(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }
}

export class MatrixCheckpointSaver<
  _GraphState extends
    IGraphStateWithRequiredFields = IGraphStateWithRequiredFields,
> extends BaseCheckpointSaver {
  private stateManager = matrixStateManager;

  // LRU Caches
  private indexCache: LRUCache<ThreadIndex>;
  private checkpointCache: LRUCache<StoredCheckpoint>;
  private writesCache: LRUCache<StoredWrite[]>;
  private latestCache: LRUCache<{
    checkpointId: string;
    lastUpdatedAt: number;
  }>;

  // Promise deduplication
  private promiseDedup = new PromiseDeduplicator<any>();

  // Metrics
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    indexRebuilds: 0,
    filteredEvents: 0,
    duplicateEvents: 0,
  };

  // Config
  private readonly cacheTTL: number;
  private readonly cacheMax: number;
  private readonly maxCheckpointSizeBytes: number;

  constructor(serde?: SerializerProtocol) {
    super(serde);

    // Read config from env
    this.cacheTTL = parseInt(
      process.env.MATRIX_CP_CACHE_TTL_MS || '300000',
      10,
    );
    this.cacheMax = parseInt(process.env.MATRIX_CP_CACHE_MAX || '50000', 10);
    this.maxCheckpointSizeBytes = parseInt(
      process.env.MATRIX_CP_MAX_SIZE_BYTES || '10485760',
      10,
    ); // 10MB default

    // Initialize caches
    this.indexCache = new LRUCache<ThreadIndex>(this.cacheMax, this.cacheTTL);
    this.checkpointCache = new LRUCache(this.cacheMax, this.cacheTTL);
    this.writesCache = new LRUCache<StoredWrite[]>(
      this.cacheMax,
      this.cacheTTL,
    );
    this.latestCache = new LRUCache(this.cacheMax, this.cacheTTL);
  }

  // Sanitize oracleDid to safe token
  private sanitizeOracleDid(oracleDid: string): string {
    return oracleDid.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  // Storage keys - following SQL table pattern with sanitization
  private getCheckpointKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    const safe = this.sanitizeOracleDid(oracleDid);
    return `${safe}_ckpt_${threadId}_${checkpointNs}_${checkpointId}`;
  }

  private getWritesKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    const safe = this.sanitizeOracleDid(oracleDid);
    return `${safe}_writes_${threadId}_${checkpointNs}_${checkpointId}`;
  }

  private getLatestCheckpointKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): string {
    const safe = this.sanitizeOracleDid(oracleDid);
    return `${safe}_latest_${threadId}_${checkpointNs}`;
  }

  private getIndexKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): string {
    const safe = this.sanitizeOracleDid(oracleDid);
    return `${safe}_index_${threadId}_${checkpointNs}`;
  }

  // Cache key builders
  private getCacheIndexKey(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): string {
    return `${roomId}:${oracleDid}:${threadId}:${checkpointNs}:index`;
  }

  private getCacheWritesKey(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    return `${roomId}:${oracleDid}:${threadId}:${checkpointNs}:${checkpointId}:writes`;
  }

  private getCacheLatestKey(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): string {
    return `${roomId}:${oracleDid}:${threadId}:${checkpointNs}:latest`;
  }

  private getCacheCheckpointKey(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    return `${roomId}:${oracleDid}:${threadId}:${checkpointNs}:${checkpointId}:checkpoint`;
  }

  // Get or build thread index
  private async getOrBuildIndex(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): Promise<ThreadIndex> {
    const cacheKey = this.getCacheIndexKey(
      roomId,
      oracleDid,
      threadId,
      checkpointNs,
    );

    return this.promiseDedup.dedupe(cacheKey, async () => {
      // Try cache first
      const cached = this.indexCache.get(cacheKey);
      if (cached) {
        this.metrics.hits++;
        Logger.debug(`Index cache HIT for ${threadId}`, {
          threadId,
          checkpointNs,
          cacheKey,
        });
        return cached;
      }

      this.metrics.misses++;

      // Try Matrix storage
      const indexKey = this.getIndexKey(oracleDid, threadId, checkpointNs);
      try {
        const stored = await this.stateManager.getState<ThreadIndex>(
          roomId,
          indexKey,
        );
        if (stored && !stored.deleted) {
          this.indexCache.set(cacheKey, stored);
          return stored;
        }
      } catch {
        // Index doesn't exist, need to build
      }

      // Build index by scanning room
      Logger.info(
        `Building index for thread ${threadId} in room ${roomId}, ns: ${checkpointNs}`,
      );
      this.metrics.indexRebuilds++;

      const stateEvents =
        await this.stateManager.listStateEvents<StoredCheckpoint>(roomId);

      // Optimized filtering with early termination and Set-based deduplication
      const checkpointIds: string[] = [];
      const seenIds = new Set<string>();
      let filteredCount = 0;
      let duplicateCount = 0;

      for (const event of stateEvents) {
        // Early filtering - check conditions in order of likelihood
        if (
          event &&
          'thread_id' in event &&
          event.thread_id === threadId &&
          'checkpoint_ns' in event &&
          event.checkpoint_ns === checkpointNs &&
          'checkpoint_id' in event &&
          event.checkpoint_id
        ) {
          if (!seenIds.has(event.checkpoint_id)) {
            checkpointIds.push(event.checkpoint_id);
            seenIds.add(event.checkpoint_id);
            filteredCount++;
          } else {
            duplicateCount++;
          }
        }
      }

      // Update metrics
      this.metrics.filteredEvents += filteredCount;
      this.metrics.duplicateEvents += duplicateCount;

      // Sort descending (newest first)
      checkpointIds.sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

      const index: ThreadIndex = {
        ids: checkpointIds,
        lastUpdatedAt: Date.now(),
      };

      // Store index
      await this.stateManager.setState({
        roomId,
        stateKey: indexKey,
        data: index,
      });

      this.indexCache.set(cacheKey, index);

      Logger.info(
        `Built index for thread ${threadId}: ${checkpointIds.length} checkpoints (${filteredCount} filtered, ${duplicateCount} duplicates)`,
        {
          threadId,
          checkpointNs,
          totalEvents: stateEvents.length,
          filteredEvents: filteredCount,
          duplicateEvents: duplicateCount,
          finalCheckpoints: checkpointIds.length,
        },
      );

      return index;
    });
  }

  // Store checkpoint with index update
  private async storeCheckpoint(
    roomId: string,
    oracleDid: string,
    storedCheckpoint: StoredCheckpoint,
  ): Promise<void> {
    const key = this.getCheckpointKey(
      oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
      storedCheckpoint.checkpoint_id,
    );

    // Add timestamp
    storedCheckpoint.lastUpdatedAt = Date.now();

    // Check size and warn
    const serialized = JSON.stringify(storedCheckpoint);
    storedCheckpoint.sizeBytes = serialized.length;
    if (serialized.length > this.maxCheckpointSizeBytes) {
      Logger.warn(
        `Checkpoint ${storedCheckpoint.checkpoint_id} exceeds size limit: ${serialized.length} bytes`,
        {
          threadId: storedCheckpoint.thread_id,
          checkpointNs: storedCheckpoint.checkpoint_ns,
          maxSize: this.maxCheckpointSizeBytes,
        },
      );
    }

    // Write checkpoint first
    await this.stateManager.setState({
      roomId,
      stateKey: key,
      data: storedCheckpoint,
    });

    // Update index
    const indexKey = this.getIndexKey(
      oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
    );
    const cacheIndexKey = this.getCacheIndexKey(
      roomId,
      oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
    );

    let index: ThreadIndex;
    try {
      index = await this.getOrBuildIndex(
        roomId,
        oracleDid,
        storedCheckpoint.thread_id,
        storedCheckpoint.checkpoint_ns,
      );
    } catch {
      index = { ids: [], lastUpdatedAt: Date.now() };
    }

    // Add new checkpoint id if not present
    if (!index.ids.includes(storedCheckpoint.checkpoint_id)) {
      index.ids.unshift(storedCheckpoint.checkpoint_id);
      index.ids.sort((a, b) => (b > a ? 1 : b < a ? -1 : 0)); // Sort desc
    }
    index.lastUpdatedAt = Date.now();

    await this.stateManager.setState({
      roomId,
      stateKey: indexKey,
      data: index,
    });

    this.indexCache.set(cacheIndexKey, index);

    // Update latest pointer last
    const latestKey = this.getLatestCheckpointKey(
      oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
    );

    await this.stateManager.setState({
      roomId,
      stateKey: latestKey,
      data: storedCheckpoint,
    });

    const latestCacheKey = this.getCacheLatestKey(
      roomId,
      oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
    );
    this.latestCache.set(latestCacheKey, {
      checkpointId: storedCheckpoint.checkpoint_id,
      lastUpdatedAt: Date.now(),
    });
  }

  // Store writes (idempotent)
  private async storeWrites(
    roomId: string,
    oracleDid: string,
    writes: StoredWrite[],
  ): Promise<void> {
    if (!writes || writes.length === 0 || !writes[0]) return;

    const key = this.getWritesKey(
      oracleDid,
      writes[0].thread_id,
      writes[0].checkpoint_ns,
      writes[0].checkpoint_id,
    );

    // Get existing writes
    const existingWrites = await this.getStoredWrites(
      roomId,
      oracleDid,
      writes[0].thread_id,
      writes[0].checkpoint_ns,
      writes[0].checkpoint_id,
    );

    // Merge writes (replace by taskId+idx)
    const writeMap = new Map<string, StoredWrite>();

    // Add existing
    for (const write of existingWrites) {
      const compositeKey = `${write.task_id}:${write.idx}`;
      writeMap.set(compositeKey, write);
    }

    // Replace or add new
    let replacedCount = 0;
    let appendedCount = 0;
    for (const write of writes) {
      const compositeKey = `${write.task_id}:${write.idx}`;
      if (writeMap.has(compositeKey)) {
        replacedCount++;
      } else {
        appendedCount++;
      }
      writeMap.set(compositeKey, write);
    }

    // Convert back to array and sort by idx
    const allWrites = Array.from(writeMap.values()).sort(
      (a, b) => a.idx - b.idx,
    );

    await this.stateManager.setState({
      roomId,
      stateKey: key,
      data: allWrites,
    });

    // Update cache
    const cacheKey = this.getCacheWritesKey(
      roomId,
      oracleDid,
      writes[0].thread_id,
      writes[0].checkpoint_ns,
      writes[0].checkpoint_id,
    );
    this.writesCache.set(cacheKey, allWrites);

    Logger.debug(
      `Stored writes for checkpoint ${writes[0].checkpoint_id}: ${replacedCount} replaced, ${appendedCount} appended`,
    );
  }

  // Get stored checkpoint (with caching)
  private async getStoredCheckpoint(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId?: string,
  ): Promise<StoredCheckpoint | undefined> {
    try {
      if (!checkpointId) {
        // Get latest checkpoint - try cache first
        const latestCacheKey = this.getCacheLatestKey(
          roomId,
          oracleDid,
          threadId,
          checkpointNs,
        );
        const cachedLatest = this.latestCache.get(latestCacheKey);
        if (cachedLatest) {
          this.metrics.hits++;
          Logger.debug(`Latest cache HIT for ${threadId}`, {
            threadId,
            checkpointNs,
            checkpointId: cachedLatest.checkpointId,
          });
          // Use cached checkpoint ID to get the actual checkpoint
          checkpointId = cachedLatest.checkpointId;
        } else {
          this.metrics.misses++;
          // Get latest checkpoint from Matrix
          const latestKey = this.getLatestCheckpointKey(
            oracleDid,
            threadId,
            checkpointNs,
          );
          const stored = await this.stateManager.getState<StoredCheckpoint>(
            roomId,
            latestKey,
          );

          // Skip null/deleted/invalid states
          if (
            !stored ||
            (stored as any).deleted ||
            !this.isValidCheckpoint(stored)
          ) {
            return undefined;
          }

          // Cache the latest checkpoint info
          this.latestCache.set(latestCacheKey, {
            checkpointId: stored.checkpoint_id,
            lastUpdatedAt: stored.lastUpdatedAt || Date.now(),
          });

          return stored;
        }
      }

      // For specific checkpoint ID - try checkpoint cache first
      const checkpointCacheKey = this.getCacheCheckpointKey(
        roomId,
        oracleDid,
        threadId,
        checkpointNs,
        checkpointId,
      );
      const cachedCheckpoint = this.checkpointCache.get(checkpointCacheKey);
      if (cachedCheckpoint) {
        this.metrics.hits++;
        Logger.debug(`Checkpoint cache HIT for ${checkpointId}`, {
          threadId,
          checkpointNs,
          checkpointId,
        });
        return cachedCheckpoint;
      }

      this.metrics.misses++;

      const key = this.getCheckpointKey(
        oracleDid,
        threadId,
        checkpointNs,
        checkpointId,
      );
      const stored = await this.stateManager.getState<StoredCheckpoint>(
        roomId,
        key,
      );

      // Skip null/deleted/invalid states
      if (
        !stored ||
        (stored as any).deleted ||
        !this.isValidCheckpoint(stored)
      ) {
        return undefined;
      }

      // Cache the checkpoint for future reads
      this.checkpointCache.set(checkpointCacheKey, stored);

      return stored;
    } catch (error) {
      Logger.debug(
        `Failed to get checkpoint: ${checkpointId || 'latest'}`,
        error,
      );
      return undefined;
    }
  }

  // Validate checkpoint has required fields
  private isValidCheckpoint(checkpoint: any): checkpoint is StoredCheckpoint {
    return (
      checkpoint &&
      typeof checkpoint === 'object' &&
      typeof checkpoint.thread_id === 'string' &&
      typeof checkpoint.checkpoint_id === 'string' &&
      typeof checkpoint.checkpoint_ns === 'string' &&
      typeof checkpoint.type === 'string' &&
      typeof checkpoint.checkpoint === 'string' &&
      typeof checkpoint.metadata === 'string'
    );
  }

  // Get stored writes (with caching)
  private async getStoredWrites(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<StoredWrite[]> {
    const cacheKey = this.getCacheWritesKey(
      roomId,
      oracleDid,
      threadId,
      checkpointNs,
      checkpointId,
    );

    // Try cache first
    const cached = this.writesCache.get(cacheKey);
    if (cached) {
      this.metrics.hits++;
      Logger.debug(`Writes cache HIT for checkpoint ${checkpointId}`, {
        checkpointId,
        cacheKey,
      });
      return cached;
    }

    this.metrics.misses++;

    try {
      const key = this.getWritesKey(
        oracleDid,
        threadId,
        checkpointNs,
        checkpointId,
      );
      const writes = await this.stateManager.getState<StoredWrite[]>(
        roomId,
        key,
      );

      // Skip null/deleted states
      if (!writes || (writes as any).deleted) {
        return [];
      }

      // Ensure sorted by idx
      const sorted = (writes || []).sort((a, b) => a.idx - b.idx);

      // Cache it
      this.writesCache.set(cacheKey, sorted);

      return sorted;
    } catch (error) {
      // M_NOT_FOUND is expected when checkpoint has no writes
      if ((error as any)?.errcode === 'M_NOT_FOUND') {
        Logger.debug(
          `No writes found for checkpoint ${checkpointId} (expected for checkpoints with writesCount=0)`,
        );
      } else {
        Logger.debug(
          `Failed to get writes for checkpoint ${checkpointId}`,
          error,
        );
      }
      return [];
    }
  }

  // Migrate pending_sends for v < 4 checkpoints (follows SQL pattern)
  private async migratePendingSends(
    mutableCheckpoint: Checkpoint,
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string,
  ): Promise<void> {
    // Get writes from parent checkpoint
    const parentWrites = await this.getStoredWrites(
      roomId,
      oracleDid,
      threadId,
      checkpointNs,
      parentCheckpointId,
    );

    // Filter for TASKS channel and sort by idx
    const taskWrites = parentWrites
      .filter((write) => write.channel === TASKS)
      .sort((a, b) => a.idx - b.idx);

    // Deserialize task values
    const pendingSends = await Promise.all(
      taskWrites.map(async (write) => {
        return await this.serde.loadsTyped(write.type, write.value);
      }),
    );

    // Add to checkpoint.channel_values[TASKS]
    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = pendingSends;

    // Update channel versions
    mutableCheckpoint.channel_versions ??= {};
    mutableCheckpoint.channel_versions[TASKS] =
      Object.keys(mutableCheckpoint.channel_versions).length > 0
        ? maxChannelVersion(
            ...Object.values(mutableCheckpoint.channel_versions),
          )
        : this.getNextVersion(undefined);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const startTime = Date.now();
    const {
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: checkpointId,
    } = config.configurable ?? {};

    if (!threadId) {
      return undefined;
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      Logger.error('Missing Matrix configs in configurable', {
        threadId,
        checkpointNs,
        checkpointId,
      });
      return undefined;
    }

    const { matrix } = configs;

    // Get stored checkpoint
    const storedCheckpoint = await this.getStoredCheckpoint(
      matrix.roomId,
      matrix.oracleDid,
      threadId,
      checkpointNs,
      checkpointId,
    );

    if (!storedCheckpoint) {
      Logger.debug('Checkpoint not found', {
        roomId: matrix.roomId,
        threadId,
        checkpointNs,
        checkpointId: checkpointId || 'latest',
      });
      return undefined;
    }

    // Deserialize checkpoint and metadata
    const checkpoint = (await this.serde.loadsTyped(
      storedCheckpoint.type,
      storedCheckpoint.checkpoint,
    )) as Checkpoint;

    const metadata = (await this.serde.loadsTyped(
      storedCheckpoint.type,
      storedCheckpoint.metadata,
    )) as CheckpointMetadata;

    // Migration check for v < 4 checkpoints
    if (checkpoint.v < 4 && storedCheckpoint.parent_checkpoint_id != null) {
      Logger.debug('Migrating v<4 checkpoint', {
        threadId,
        checkpointId: storedCheckpoint.checkpoint_id,
        parentCheckpointId: storedCheckpoint.parent_checkpoint_id,
      });
      await this.migratePendingSends(
        checkpoint,
        matrix.roomId,
        matrix.oracleDid,
        storedCheckpoint.thread_id,
        storedCheckpoint.checkpoint_ns,
        storedCheckpoint.parent_checkpoint_id,
      );
    }

    // Get pending writes for current checkpoint (sorted by idx)
    const storedWrites = await this.getStoredWrites(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
      storedCheckpoint.checkpoint_id,
    );

    // Map to CheckpointPendingWrite[] (already sorted by idx from getStoredWrites)
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      storedWrites.map(async (write): Promise<CheckpointPendingWrite> => {
        const value = await this.serde.loadsTyped(write.type, write.value);
        return [write.task_id, write.channel, value];
      }),
    );

    const finalConfig = {
      configurable: {
        thread_id: storedCheckpoint.thread_id,
        checkpoint_ns: storedCheckpoint.checkpoint_ns,
        checkpoint_id: storedCheckpoint.checkpoint_id,
      },
    };

    const duration = Date.now() - startTime;
    Logger.debug(`getTuple completed in ${duration}ms`, {
      threadId,
      checkpointId: storedCheckpoint.checkpoint_id,
      writesCount: pendingWrites.length,
    });

    return {
      config: finalConfig,
      checkpoint,
      metadata,
      parentConfig: storedCheckpoint.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: storedCheckpoint.thread_id,
              checkpoint_ns: storedCheckpoint.checkpoint_ns,
              checkpoint_id: storedCheckpoint.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const startTime = Date.now();
    const { thread_id: threadId, checkpoint_ns: checkpointNs = '' } =
      config.configurable ?? {};

    if (!threadId) {
      return;
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      Logger.error('Missing Matrix configs in list', { threadId });
      return;
    }

    const { matrix } = configs;

    // Extract options
    const { filter, before, limit } = options ?? {};

    // Get or build thread index
    const index = await this.getOrBuildIndex(
      matrix.roomId,
      matrix.oracleDid,
      threadId,
      checkpointNs,
    );

    // Handle missing or deleted index
    if (!index || index.deleted) {
      Logger.debug('Index not found or deleted', {
        threadId,
        checkpointNs,
        deleted: index?.deleted,
      });
      return;
    }

    if (index.ids.length === 0) {
      Logger.debug('No checkpoints in index', {
        threadId,
        checkpointNs,
      });
      return;
    }

    // Filter checkpoint ids
    let checkpointIds = [...index.ids]; // Already sorted desc

    // Apply "before" filter (lexicographic <)
    if (before?.configurable?.checkpoint_id) {
      const beforeId = before.configurable.checkpoint_id;
      checkpointIds = checkpointIds.filter((id) => id < beforeId);
    }

    // Apply limit
    if (limit !== undefined) {
      checkpointIds = checkpointIds.slice(0, limit);
    }

    Logger.debug(`Listing ${checkpointIds.length} checkpoints`, {
      threadId,
      total: index.ids.length,
      filtered: checkpointIds.length,
    });

    let yieldedCount = 0;
    for (const checkpointId of checkpointIds) {
      try {
        // Get stored checkpoint
        const storedCheckpoint = await this.getStoredCheckpoint(
          matrix.roomId,
          matrix.oracleDid,
          threadId,
          checkpointNs,
          checkpointId,
        );

        if (!storedCheckpoint) {
          Logger.warn('Checkpoint in index but not found in storage', {
            threadId,
            checkpointId,
          });
          continue;
        }

        // Deserialize checkpoint and metadata
        const checkpoint = (await this.serde.loadsTyped(
          storedCheckpoint.type,
          storedCheckpoint.checkpoint,
        )) as Checkpoint;

        const metadata = (await this.serde.loadsTyped(
          storedCheckpoint.type,
          storedCheckpoint.metadata,
        )) as CheckpointMetadata;

        // Apply metadata filter (shallow equality match)
        if (filter && Object.keys(filter).length > 0) {
          let matches = true;
          for (const [key, value] of Object.entries(filter)) {
            if ((metadata as any)[key] !== value) {
              matches = false;
              break;
            }
          }
          if (!matches) {
            continue;
          }
        }

        // Migration check for v < 4 checkpoints
        if (checkpoint.v < 4 && storedCheckpoint.parent_checkpoint_id != null) {
          await this.migratePendingSends(
            checkpoint,
            matrix.roomId,
            matrix.oracleDid,
            storedCheckpoint.thread_id,
            storedCheckpoint.checkpoint_ns,
            storedCheckpoint.parent_checkpoint_id,
          );
        }

        yield {
          config: {
            configurable: {
              thread_id: storedCheckpoint.thread_id,
              checkpoint_ns: storedCheckpoint.checkpoint_ns,
              checkpoint_id: storedCheckpoint.checkpoint_id,
            },
          },
          checkpoint,
          metadata,
          parentConfig: storedCheckpoint.parent_checkpoint_id
            ? {
                configurable: {
                  thread_id: storedCheckpoint.thread_id,
                  checkpoint_ns: storedCheckpoint.checkpoint_ns,
                  checkpoint_id: storedCheckpoint.parent_checkpoint_id,
                },
              }
            : undefined,
        };

        yieldedCount++;
      } catch (error) {
        // Skip corrupted checkpoints
        Logger.warn('Skipping corrupted checkpoint', {
          checkpointId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const duration = Date.now() - startTime;
    Logger.debug(`list completed in ${duration}ms`, {
      threadId,
      yieldedCount,
      cacheHits: this.metrics.hits,
      cacheMisses: this.metrics.misses,
    });
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const {
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: parentCheckpointId,
    } = config.configurable ?? {};

    if (!threadId) {
      throw new Error('Missing thread_id in config.configurable');
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      throw new Error('Missing Matrix configs in configurable');
    }

    const { matrix } = configs;

    // NEW: Use copyCheckpoint to prepare checkpoint
    const preparedCheckpoint: Partial<Checkpoint> = copyCheckpoint(checkpoint);

    // Serialize checkpoint and metadata
    const [serializationType, serializedCheckpoint] =
      await this.serde.dumpsTyped(preparedCheckpoint);
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);

    const storedCheckpoint: StoredCheckpoint = {
      thread_id: threadId,
      checkpoint_id: checkpoint.id,
      checkpoint_ns: checkpointNs,
      parent_checkpoint_id: parentCheckpointId,
      type: serializationType,
      checkpoint: new TextDecoder().decode(serializedCheckpoint),
      metadata: new TextDecoder().decode(serializedMetadata),
    };

    await this.storeCheckpoint(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint,
    );

    // NEW: Return standard RunnableConfig
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const {
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: checkpointId,
    } = config.configurable ?? {};

    if (!threadId || !checkpointId) {
      Logger.error('Missing thread_id or checkpoint_id in putWrites', {
        threadId,
        checkpointId,
      });
      throw new Error(
        'Missing thread_id or checkpoint_id in config.configurable',
      );
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      Logger.error('Missing Matrix configs in putWrites', {
        threadId,
        checkpointId,
      });
      throw new Error('Missing Matrix configs in configurable');
    }

    const { matrix } = configs;

    // Map writes with WRITES_IDX_MAP
    const storedWrites: StoredWrite[] = await Promise.all(
      writes.map(async ([channel, value], originalIdx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(value);
        // Use WRITES_IDX_MAP for deterministic idx
        const idx = WRITES_IDX_MAP[channel] ?? originalIdx;
        return {
          thread_id: threadId,
          checkpoint_id: checkpointId,
          checkpoint_ns: checkpointNs,
          task_id: taskId,
          idx,
          channel,
          type,
          value: new TextDecoder().decode(serializedValue),
        };
      }),
    );

    await this.storeWrites(matrix.roomId, matrix.oracleDid, storedWrites);

    Logger.debug(`putWrites completed`, {
      threadId,
      checkpointId,
      taskId,
      writesCount: storedWrites.length,
    });
  }

  // Implement deleteThread with state nullification
  public async deleteThread(threadId: string): Promise<void> {
    Logger.info(`Deleting thread ${threadId}`);

    // We need to iterate through all possible checkpointNs values
    // For now, we'll assume empty string as the default namespace
    // In a production scenario, you'd need to track all namespaces used
    const checkpointNs = '';

    // Note: We need roomId and oracleDid, but deleteThread doesn't have them in signature
    // This is a limitation - we'll need to scan all rooms or accept roomId as parameter
    // For now, throw error suggesting to pass config with Matrix details

    throw new Error(
      `deleteThread not fully implemented - requires roomId and oracleDid. ` +
        `Thread ID: ${threadId}, namespace: ${checkpointNs}. ` +
        `Consider implementing a version that accepts full config.`,
    );
  }

  // Helper to delete thread with full context
  public async deleteThreadWithContext(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string = '',
  ): Promise<void> {
    Logger.info(`Deleting thread ${threadId} in room ${roomId}`, {
      oracleDid,
      checkpointNs,
    });

    try {
      // Get thread index
      const index = await this.getOrBuildIndex(
        roomId,
        oracleDid,
        threadId,
        checkpointNs,
      );

      // Nullify all checkpoints and writes
      for (const checkpointId of index.ids) {
        // Nullify checkpoint
        const checkpointKey = this.getCheckpointKey(
          oracleDid,
          threadId,
          checkpointNs,
          checkpointId,
        );
        await this.stateManager.setState({
          roomId,
          stateKey: checkpointKey,
          data: null as any,
        });

        // Nullify writes
        const writesKey = this.getWritesKey(
          oracleDid,
          threadId,
          checkpointNs,
          checkpointId,
        );
        await this.stateManager.setState({
          roomId,
          stateKey: writesKey,
          data: null as any,
        });
      }

      // Nullify latest pointer
      const latestKey = this.getLatestCheckpointKey(
        oracleDid,
        threadId,
        checkpointNs,
      );
      await this.stateManager.setState({
        roomId,
        stateKey: latestKey,
        data: null as any,
      });

      // Mark index as deleted
      const indexKey = this.getIndexKey(oracleDid, threadId, checkpointNs);
      await this.stateManager.setState({
        roomId,
        stateKey: indexKey,
        data: { ids: [], deleted: true, lastUpdatedAt: Date.now() },
      });

      // Purge all LRU entries for this thread
      const threadPattern = `${roomId}:${oracleDid}:${threadId}:${checkpointNs}`;
      this.indexCache.deletePattern(threadPattern);
      this.checkpointCache.deletePattern(threadPattern);
      this.writesCache.deletePattern(threadPattern);
      this.latestCache.deletePattern(threadPattern);

      Logger.info(`Deleted thread ${threadId}`, {
        roomId,
        checkpointCount: index.ids.length,
      });
    } catch (error) {
      Logger.error(`Failed to delete thread ${threadId}`, error);
      throw error;
    }
  }

  // Add end() no-op for API symmetry
  public async end(): Promise<void> {
    // No-op for compatibility with Postgres saver
    Logger.debug('end() called (no-op)');
  }

  // Get cache metrics (useful for debugging/monitoring)
  public getCacheMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  // Get filtering performance metrics
  public getFilteringMetrics(): {
    filteredEvents: number;
    duplicateEvents: number;
    indexRebuilds: number;
    avgEventsPerRebuild: number;
  } {
    const avgEventsPerRebuild =
      this.metrics.indexRebuilds > 0
        ? this.metrics.filteredEvents / this.metrics.indexRebuilds
        : 0;

    return {
      filteredEvents: this.metrics.filteredEvents,
      duplicateEvents: this.metrics.duplicateEvents,
      indexRebuilds: this.metrics.indexRebuilds,
      avgEventsPerRebuild: Math.round(avgEventsPerRebuild),
    };
  }
}
