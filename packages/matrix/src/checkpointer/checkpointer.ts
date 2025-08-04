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
  copyCheckpoint,
  maxChannelVersion,
} from '@langchain/langgraph-checkpoint';

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

export class MatrixCheckpointSaver<
  _GraphState extends
    IGraphStateWithRequiredFields = IGraphStateWithRequiredFields,
> extends BaseCheckpointSaver {
  private stateManager = matrixStateManager;

  constructor(serde?: SerializerProtocol) {
    super(serde);
  }

  public async deleteThread(threadId: string): Promise<void> {
    throw new Error('Not implemented' + threadId);
  }

  // Storage keys - following SQL table pattern
  private getCheckpointKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    return `${oracleDid}_checkpoint_${threadId}_${checkpointNs}_${checkpointId}`;
  }

  private getWritesKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): string {
    return `${oracleDid}_writes_${threadId}_${checkpointNs}_${checkpointId}`;
  }

  private getLatestCheckpointKey(
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
  ): string {
    return `${oracleDid}_latest_${threadId}_${checkpointNs}`;
  }

  // Store checkpoint (without pending_sends like SQL)
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

    await this.stateManager.setState({
      roomId,
      stateKey: key,
      data: storedCheckpoint,
    });

    // Also store as latest checkpoint
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
  }

  // Store writes
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

    // Get existing writes and append new ones
    const existingWrites = await this.getStoredWrites(
      roomId,
      oracleDid,
      writes[0].thread_id,
      writes[0].checkpoint_ns,
      writes[0].checkpoint_id,
    );
    const allWrites = [...existingWrites, ...writes];

    await this.stateManager.setState({
      roomId,
      stateKey: key,
      data: allWrites,
    });
  }

  // Get stored checkpoint
  private async getStoredCheckpoint(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId?: string,
  ): Promise<StoredCheckpoint | undefined> {
    try {
      if (!checkpointId) {
        // Get latest checkpoint
        const latestKey = this.getLatestCheckpointKey(
          oracleDid,
          threadId,
          checkpointNs,
        );
        return await this.stateManager.getState<StoredCheckpoint>(
          roomId,
          latestKey,
        );
      }

      const key = this.getCheckpointKey(
        oracleDid,
        threadId,
        checkpointNs,
        checkpointId,
      );
      return await this.stateManager.getState<StoredCheckpoint>(roomId, key);
    } catch {
      return undefined;
    }
  }

  // Get stored writes
  private async getStoredWrites(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<StoredWrite[]> {
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
      return writes || [];
    } catch {
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
      throw new Error('Missing Matrix configs in configurable');
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

    // NEW: Migration check for v < 4 checkpoints
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

    // Get pending writes for current checkpoint
    const storedWrites = await this.getStoredWrites(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
      storedCheckpoint.checkpoint_id,
    );

    // NEW: Use CheckpointPendingWrite[] type
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

    return {
      config: finalConfig,
      checkpoint, // NEW: No more manual pending_sends injection
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
    _options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id: threadId } = config.configurable ?? {};

    if (!threadId) {
      return;
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      return;
    }

    const { matrix } = configs;

    // Get all state events and filter for checkpoints
    const stateEvents =
      await this.stateManager.listStateEvents<StoredCheckpoint>(matrix.roomId);

    const checkpoints = stateEvents
      .filter(
        (event) =>
          event &&
          'thread_id' in event &&
          event.thread_id === threadId &&
          'checkpoint_id' in event,
      )
      .reverse(); // Most recent first

    for (const storedCheckpoint of checkpoints) {
      if (!storedCheckpoint) continue;

      try {
        // Deserialize checkpoint and metadata
        const checkpoint = (await this.serde.loadsTyped(
          storedCheckpoint.type,
          storedCheckpoint.checkpoint,
        )) as Checkpoint;

        const metadata = (await this.serde.loadsTyped(
          storedCheckpoint.type,
          storedCheckpoint.metadata,
        )) as CheckpointMetadata;

        // NEW: Migration check for v < 4 checkpoints
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
      } catch (error) {
        // Skip corrupted checkpoints
        console.warn('Skipping corrupted checkpoint:', error);
        continue;
      }
    }
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
      throw new Error(
        'Missing thread_id or checkpoint_id in config.configurable',
      );
    }

    // Extract Matrix configs (Matrix-specific)
    const configs = (config.configurable as any)?.configs;
    if (!configs) {
      throw new Error('Missing Matrix configs in configurable');
    }

    const { matrix } = configs;

    const storedWrites: StoredWrite[] = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(value);
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
  }
}
