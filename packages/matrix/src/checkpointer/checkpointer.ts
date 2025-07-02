import { Logger } from '@ixo/logger';

import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { MatrixManager } from '../matrix-manager';
import {
  type IMatrixManagerInitConfig,
  type OraclesNamesOnMatrix,
} from '../types';
import {
  type ICheckpointRow,
  type IGraphStateWithRequiredFields,
  type IRunnableConfigWithRequiredFields,
  type IWritesRow,
  type SaveStateParams,
} from './types';

export class MatrixCheckpointSaver<
  GraphState extends
    IGraphStateWithRequiredFields = IGraphStateWithRequiredFields,
> extends BaseCheckpointSaver {
  private matrixManager: MatrixManager | undefined;
  public readonly oracleName: OraclesNamesOnMatrix;

  constructor(oracleName: OraclesNamesOnMatrix, serde?: SerializerProtocol) {
    super(serde);
    this.oracleName = oracleName;
  }

  private setupMatrixManager = async (
    matrixConfig: Pick<IMatrixManagerInitConfig, 'accessToken'> & {
      roomId: string;
    },
  ): Promise<void> => {
    if (this.matrixManager) {
      return;
    }
    if (!matrixConfig.accessToken) {
      throw new Error('Missing access token');
    }
    const matrixManager = MatrixManager.getInstance();
    if (!matrixManager.getInitializationStatus().isInitialized) {
      await matrixManager.init();
    }

    this.matrixManager = matrixManager;
  };

  private getState = async ({
    stateKey,
    roomId,
    oracleDid,
  }: {
    stateKey: string;
    roomId: string;
    oracleDid: string;
  }): Promise<ICheckpointRow<GraphState> | IWritesRow[] | undefined> => {
    try {
      if (!this.matrixManager?.stateManager) {
        throw new Error('MatrixManager not initialized');
      }

      const state = await this.matrixManager.stateManager.getState<
        ICheckpointRow<GraphState> | IWritesRow[]
      >(roomId, `${oracleDid}_graph_${stateKey}`);
      return state;
    } catch (error) {
      return undefined;
    }
  };

  private async getCheckpoint({
    threadId,
    roomId,
    checkpointId,
    checkpointNamespace,
    oracleDid,
  }: {
    threadId: string;
    roomId: string;
    checkpointId?: string;
    checkpointNamespace?: string;
    oracleDid: string;
  }): Promise<ICheckpointRow<GraphState> | undefined> {
    if (!this.matrixManager) {
      throw new Error('MatrixManager not initialized');
    }
    if (!checkpointId) {
      const room = this.matrixManager.getOracleRoom(roomId);

      if (!room) {
        throw new Error(`getCheckpoint: Room not found: ${roomId}`);
      }

      const latestCheckpointEvent = (await this.getState({
        roomId,
        oracleDid,
        stateKey: `${threadId}_latest_checkpoint`,
      })) as ICheckpointRow<GraphState> | undefined;

      return latestCheckpointEvent;
    }

    const checkpointStateKey = `${threadId}_${checkpointNamespace}_${checkpointId}`;
    const checkpointState = (await this.getState({
      stateKey: checkpointStateKey,
      roomId,
      oracleDid,
    })) as ICheckpointRow<GraphState>;
    return checkpointState;
  }
  private async saveCheckpoint({
    threadId,
    roomId,
    checkpointId,
    checkpointNamespace,
    checkpoint,
    oracleDid,
  }: {
    threadId: string;
    roomId: string;
    checkpointId: string;
    checkpointNamespace: string;
    checkpoint: ICheckpointRow<GraphState>;
    oracleDid: string;
  }): Promise<void> {
    const checkpointStateKey = `${threadId}_${checkpointNamespace}_${checkpointId}`;
    if (!this.matrixManager?.stateManager) {
      throw new Error('MatrixManager not initialized');
    }
    await this.matrixManager.stateManager.setState<ICheckpointRow<GraphState>>({
      roomId,
      stateKey: `${oracleDid}_graph_${checkpointStateKey}`,
      data: checkpoint,
    });

    // save the latest checkpoint
    const latestCheckpointStateKey = `${threadId}_latest_checkpoint`;
    await this.matrixManager.stateManager.setState<ICheckpointRow<GraphState>>({
      roomId,
      stateKey: `${oracleDid}_graph_${latestCheckpointStateKey}`,
      data: checkpoint,
    });

    if (!process.env.SKIP_LOGGING_CHAT_HISTORY_TO_MATRIX) {
      this.sendMessageToMatrixInBackground({ ...checkpoint }, roomId);
    }
  }

  private async getWrites({
    threadId,
    roomId,
    checkpointId,
    checkpointNamespace,
    oracleDid,
  }: {
    threadId: string;
    roomId: string;
    checkpointId?: string;
    checkpointNamespace?: string;
    oracleDid: string;
  }): Promise<IWritesRow[] | undefined> {
    const checkpointStateKey = `${threadId}_${checkpointNamespace}_${checkpointId}_w`;
    const writes = (await this.getState({
      roomId,
      stateKey: checkpointStateKey,
      oracleDid,
    })) as IWritesRow[];
    return writes;
  }

  private async saveWrites({
    threadId,
    roomId,
    checkpointId,
    checkpointNamespace,
    writes,
    oracleDid,
  }: {
    threadId: string;
    roomId: string;
    checkpointId: string;
    checkpointNamespace: string;
    writes: IWritesRow[];
    oracleDid: string;
  }): Promise<void> {
    const checkpointStateKey = `${threadId}_${checkpointNamespace}_${checkpointId}_w`;
    if (!this.matrixManager?.stateManager) {
      throw new Error('MatrixManager not initialized');
    }
    const oldWrites =
      (await this.getWrites({
        threadId,
        roomId,
        checkpointId,
        checkpointNamespace,
        oracleDid,
      })) ?? [];
    await this.matrixManager.stateManager.setState<IWritesRow[]>({
      roomId,
      stateKey: `${oracleDid}_graph_${checkpointStateKey}`,
      data: [...writes, ...oldWrites],
    });
  }

  private jsonToArrayBuffer(data: object): Uint8Array {
    if (typeof data === 'string') {
      return data;
    }
    const jsonString = JSON.stringify(data);
    // Step 2: Encode the string to UTF-8
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(jsonString);

    return uint8Array;
  }

  private sendMessageToMatrixInBackground(
    checkpointValue: ICheckpointRow<GraphState>,
    roomId: string,
  ): void {
    if (!this.matrixManager) {
      throw new Error('MatrixManager not initialized');
    }
    const msgs = checkpointValue.checkpoint.channel_values.messages ?? [];
    const lastMessage = msgs.at(-1);

    if (lastMessage && !lastMessage.lc_kwargs.sent) {
      const isOracleMessage = lastMessage.getType() === 'ai';
      this.matrixManager
        .sendMessage({
          message: lastMessage.content.toString(),
          roomId,
          isOracleAdmin: isOracleMessage,
        })
        .then(() => {
          lastMessage.lc_kwargs.sent = true;
        })
        .catch((error) => {
          Logger.error('Error sending message to matrix:', error);
          throw error;
        });
    }
  }
  private saveState = async ({
    threadId,
    value: checkpointValue,
    writesValue,
    config,
  }: SaveStateParams<GraphState>): Promise<void> => {
    const { matrix } = config;
    if (!this.matrixManager) {
      await this.setupMatrixManager(matrix);
    }

    if (!this.matrixManager) {
      throw new Error('MatrixManager not initialized');
    }

    if (checkpointValue) {
      await this.saveCheckpoint({
        checkpointId: checkpointValue.checkpoint_id,
        checkpoint: checkpointValue,
        checkpointNamespace: checkpointValue.checkpoint_ns ?? '',
        roomId: matrix.roomId,
        threadId,
        oracleDid: matrix.oracleDid,
      });
    } else if (writesValue) {
      await this.saveWrites({
        checkpointId: writesValue.checkpoint_id ?? '',
        checkpointNamespace: writesValue.checkpoint_ns ?? '',
        roomId: matrix.roomId,
        threadId,
        writes: [writesValue],
        oracleDid: matrix.oracleDid,
      });
    } else {
      throw new Error('Missing value');
    }
  };

  private async getRow<T extends 'checkpoints' | 'writes'>({
    threadId,
    checkpointNamespace,
    checkpointId,
    table,
    config,
  }: {
    table: T;
    threadId: string;
    checkpointNamespace?: string;
    checkpointId?: string;
    config: NonNullable<
      IRunnableConfigWithRequiredFields['configurable']['configs']
    >;
  }): Promise<
    | (T extends 'checkpoints' ? ICheckpointRow<GraphState> : IWritesRow[])
    | undefined
  > {
    // check if ./state folder exists
    const { matrix } = config;
    if (!this.matrixManager) {
      await this.setupMatrixManager(matrix);
    }

    if (table === 'checkpoints') {
      const checkpointRow = await this.getCheckpoint({
        roomId: matrix.roomId,
        threadId,
        checkpointId,
        checkpointNamespace,
        oracleDid: matrix.oracleDid,
      });
      if (!checkpointRow) return undefined;
      const checkpoint = (await this.serde.loadsTyped(
        'json',
        this.jsonToArrayBuffer({
          ...checkpointRow.checkpoint,
          pending_sends:
            Array.isArray(checkpointRow.checkpoint.pending_sends) &&
            checkpointRow.checkpoint.pending_sends.length > 0
              ? checkpointRow.checkpoint.pending_sends
              : [],
        }),
      )) as Checkpoint;
      const metadata = (await this.serde.loadsTyped(
        'json',
        this.jsonToArrayBuffer(checkpointRow.metadata),
      )) as CheckpointMetadata;
      return {
        ...checkpointRow,
        checkpoint,
        metadata,
      } as unknown as T extends 'checkpoints'
        ? ICheckpointRow<GraphState>
        : IWritesRow[];
    }

    const writesRows = await this.getWrites({
      roomId: matrix.roomId,
      threadId,
      checkpointId,
      checkpointNamespace,
      oracleDid: matrix.oracleDid,
    });
    if (!writesRows)
      return [] as unknown as T extends 'checkpoints'
        ? ICheckpointRow<GraphState>
        : IWritesRow[];

    return Promise.all(
      writesRows.map(async (row) => {
        const valueAsStr = row.value ?? '';
        const type = row.type ?? 'json';
        const value = (await this.serde.loadsTyped(
          type,
          typeof row.value === 'object'
            ? this.jsonToArrayBuffer(row.value)
            : valueAsStr,
        )) as string;
        return {
          ...row,
          value,
        } as IWritesRow;
      }),
    ) as unknown as T extends 'checkpoints'
      ? ICheckpointRow<GraphState>
      : IWritesRow[];
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

    if (!configs) {
      throw TypeError('Missing configs in config');
    }

    const row = await this.getRow({
      table: 'checkpoints',
      threadId: threadId ?? '',
      checkpointNamespace: checkpointNs,
      config: configs,
      checkpointId,
    });

    if (!row) {
      return undefined;
    }

    let finalConfig = config;

    if (!checkpointId) {
      finalConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      };
    }

    if (
      !finalConfig.configurable.thread_id ||
      !finalConfig.configurable.checkpoint_id
    ) {
      throw new Error('Missing thread_id or checkpoint_id');
    }

    const pendingWritesRows = await this.getRow({
      table: 'writes',
      threadId: threadId ?? '',
      checkpointNamespace: checkpointNs,
      checkpointId,
      config: configs,
    });
    const pendingWrites = pendingWritesRows?.map((r) => {
      return [r.task_id, r.channel, r.value];
    });
    return {
      config: finalConfig,
      checkpoint: row.checkpoint,
      metadata: row.metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites: pendingWrites as [string, string, unknown][],
    };
  }

  async *list(
    config: IRunnableConfigWithRequiredFields,
    _options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id: threadId, configs } = config.configurable;

    if (!configs) {
      throw TypeError('Missing configs in config');
    }

    if (!this.matrixManager) {
      await this.setupMatrixManager(configs.matrix);
    }

    if (!this.matrixManager?.stateManager) {
      throw new Error('MatrixManager not initialized');
    }

    const room = this.matrixManager.getOracleRoom(configs.matrix.roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    const stateEvents = await this.matrixManager.stateManager.listStateEvents<
      ICheckpointRow<GraphState> | IWritesRow
    >(room);

    const rows = stateEvents.reduce<(ICheckpointRow<GraphState> | undefined)[]>(
      (acc, event) => {
        if (event.thread_id === threadId && 'checkpoint' in event) {
          acc.push(event);
        }
        return acc;
      },
      [],
    );

    const orderedRows = rows.reverse();
    for (const row of orderedRows) {
      if (!row) continue;
      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint: row.checkpoint,
        metadata: row.metadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
      };
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
    if (!config.configurable.thread_id) {
      throw new Error('Missing thread_id in config.');
    }

    const {
      configs,
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: parentCheckpointId,
    } = config.configurable;

    if (!configs) {
      throw TypeError('Missing configs in config');
    }

    const row: ICheckpointRow<GraphState> = {
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: parentCheckpointId,
      type: 'json',
      checkpoint: checkpoint as ICheckpointRow<GraphState>['checkpoint'],
      metadata,
    };

    await this.saveState({
      threadId,
      checkpointNamespace: checkpointNs,
      checkpointId: checkpoint.id,
      value: row,
      config: configs,
    });
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
      checkpoint_ns: checkpointNs,
      checkpoint_id: parentCheckpointId,
    } = config.configurable;

    if (!threadId) {
      throw new Error('Missing thread_id in config');
    }
    if (!configs) {
      throw TypeError('Missing configs in config');
    }
    const rows: IWritesRow[] = writes.map(([channel, writeValue], idx) => {
      const [type] = this.serde.dumpsTyped(writeValue);
      return {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: parentCheckpointId,
        task_id: taskId,
        idx,
        channel,
        type,
        value: writeValue as string,
      };
    });
    await Promise.all(
      rows.map(async (row) => {
        await this.saveState({
          threadId: row.thread_id,
          checkpointNamespace: row.checkpoint_ns,
          checkpointId: row.checkpoint_id,
          writesValue: row,
          config: configs,
        });
      }),
    );
  }
}
