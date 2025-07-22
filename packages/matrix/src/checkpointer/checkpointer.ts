import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
  TASKS,
} from '@langchain/langgraph-checkpoint';

import { matrixStateManager } from '../matrix-state-manager/matrix-state-manager.js';
import type {
  IGraphStateWithRequiredFields,
  IRunnableConfigWithRequiredFields,
} from './types.js';

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

  // Reconstruct pending_sends from parent writes (like SQL subquery)
  private async getPendingSends(
    roomId: string,
    oracleDid: string,
    threadId: string,
    checkpointNs: string,
    parentCheckpointId?: string,
  ): Promise<unknown[]> {
    if (!parentCheckpointId) return [];

    const parentWrites = await this.getStoredWrites(
      roomId,
      oracleDid,
      threadId,
      checkpointNs,
      parentCheckpointId,
    );

    // Filter for TASKS channel and sort by idx (like SQL ORDER BY)
    const taskWrites = parentWrites
      .filter((write) => write.channel === TASKS)
      .sort((a, b) => a.idx - b.idx);

    // Deserialize task values
    const pendingSends = await Promise.all(
      taskWrites.map(async (write) => {
        return await this.serde.loadsTyped(write.type, write.value);
      }),
    );

    return pendingSends;
  }

  async getTuple(
    config: IRunnableConfigWithRequiredFields,
  ): Promise<CheckpointTuple | undefined> {
    const {
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: checkpointId,
      configs,
    } = config.configurable;

    if (!configs || !threadId) {
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

    // Get pending writes for current checkpoint
    const storedWrites = await this.getStoredWrites(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
      storedCheckpoint.checkpoint_id,
    );

    const pendingWrites: [string, string, unknown][] = await Promise.all(
      storedWrites.map(async (write): Promise<[string, string, unknown]> => {
        const value = await this.serde.loadsTyped(write.type, write.value);
        return [write.task_id, write.channel, value];
      }),
    );

    // Reconstruct pending_sends from parent checkpoint (like SQL)
    const pendingSends = await this.getPendingSends(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint.thread_id,
      storedCheckpoint.checkpoint_ns,
      storedCheckpoint.parent_checkpoint_id,
    );

    // Reconstruct checkpoint with pending_sends
    const reconstructedCheckpoint: Checkpoint = {
      ...checkpoint,
      pending_sends: pendingSends as any[], // Will be properly typed by LangGraph
    };

    const finalConfig = {
      configurable: {
        thread_id: storedCheckpoint.thread_id,
        checkpoint_ns: storedCheckpoint.checkpoint_ns,
        checkpoint_id: storedCheckpoint.checkpoint_id,
      },
    };

    return {
      config: finalConfig,
      checkpoint: reconstructedCheckpoint,
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
    config: IRunnableConfigWithRequiredFields,
    _options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id: threadId, configs } = config.configurable;

    if (!configs || !threadId) {
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
    config: IRunnableConfigWithRequiredFields,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<{
    configurable: {
      thread_id: string;
      checkpoint_ns?: string;
      checkpoint_id: string;
    };
  }> {
    const {
      configs,
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: parentCheckpointId,
    } = config.configurable;

    if (!configs || !threadId) {
      throw new Error('Missing configs or thread_id in config');
    }

    const { matrix } = configs;

    // Remove pending_sends before storing (like SQL)
    const { pending_sends: _pending_sends, ...checkpointToStore } = checkpoint;

    // Serialize checkpoint and metadata with same type (like SQL)
    const [serializationType, serializedCheckpoint] =
      this.serde.dumpsTyped(checkpointToStore);
    const [, serializedMetadata] = this.serde.dumpsTyped(metadata);

    const storedCheckpoint: StoredCheckpoint = {
      thread_id: threadId,
      checkpoint_id: checkpoint.id,
      checkpoint_ns: checkpointNs,
      parent_checkpoint_id: parentCheckpointId,
      type: serializationType, // Single type for both checkpoint and metadata
      checkpoint: new TextDecoder().decode(serializedCheckpoint),
      metadata: new TextDecoder().decode(serializedMetadata),
    };

    await this.storeCheckpoint(
      matrix.roomId,
      matrix.oracleDid,
      storedCheckpoint,
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: IRunnableConfigWithRequiredFields,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const {
      configs,
      thread_id: threadId,
      checkpoint_ns: checkpointNs = '',
      checkpoint_id: checkpointId,
    } = config.configurable;

    if (!configs || !threadId || !checkpointId) {
      throw new Error('Missing configs, thread_id, or checkpoint_id in config');
    }

    const { matrix } = configs;

    const storedWrites: StoredWrite[] = writes.map(([channel, value], idx) => {
      const [type, serializedValue] = this.serde.dumpsTyped(value);
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
    });

    await this.storeWrites(matrix.roomId, matrix.oracleDid, storedWrites);
  }
}
