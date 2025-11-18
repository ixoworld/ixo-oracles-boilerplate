import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
  WRITES_IDX_MAP,
} from '@langchain/langgraph-checkpoint';

import { getMigrations } from './migrations.js';
import {
  type SQL_STATEMENTS,
  type SQL_TYPES,
  getSQLStatements,
} from './sql.js';
import { closeDb, getDb, initDb } from './store/db.js';
import { SurrealDBConnectionConfig } from './store/types.js';

// Default checkpoint namespace
const DEFAULT_CHECKPOINT_NS = '';

/**
 * LangGraph checkpointer that uses a SurrealDB instance as the backing store.
 *
 * @example
 * ```
 * import { ChatOpenAI } from "@langchain/openai";
 * import { SurrealDBSaver } from "@langchain/langgraph-checkpoint-postgres";
 * import { createReactAgent } from "@langchain/langgraph/prebuilt";
 *
 * const checkpointer = SurrealDBSaver.fromConnString(
 *   "ws://localhost:8000",
 *   {
 *     namespace: "myapp",
 *     database: "checkpoints",
 *     auth: { username: "root", password: "root" }
 *   }
 * );
 *
 * // NOTE: you need to call .setup() the first time you're using your checkpointer
 * await checkpointer.setup();
 *
 * const graph = createReactAgent({
 *   tools: [getWeather],
 *   llm: new ChatOpenAI({
 *     model: "gpt-4o-mini",
 *   }),
 *   checkpointSaver: checkpointer,
 * });
 * const config = { configurable: { thread_id: "1" } };
 *
 * await graph.invoke({
 *   messages: [{
 *     role: "user",
 *     content: "what's the weather in sf"
 *   }],
 * }, config);
 * ```
 */
export class SurrealDBSaver extends BaseCheckpointSaver {
  private readonly connectionConfig: SurrealDBConnectionConfig;

  private readonly SQL_STATEMENTS: SQL_STATEMENTS;

  protected isSetup: boolean;

  constructor(config: SurrealDBConnectionConfig, serde?: SerializerProtocol) {
    super(serde);
    this.connectionConfig = config;
    this.isSetup = false;
    this.SQL_STATEMENTS = getSQLStatements();
  }

  /**
   * Creates a new instance of SurrealDBSaver from a connection URL.
   *
   * @param {string} url - The connection URL for SurrealDB (e.g., "ws://localhost:8000").
   * @param {object} [config] - Optional configuration object.
   * @returns {SurrealDBSaver} A new instance of SurrealDBSaver.
   *
   * @example
   * const checkpointer = SurrealDBSaver.fromConnString(
   *   "ws://localhost:8000",
   *   {
   *     namespace: "myapp",
   *     database: "checkpoints",
   *     auth: { username: "root", password: "root" }
   *   }
   * );
   * await checkpointer.setup();
   */
  static fromConnString(
    url: string,
    config?: Omit<SurrealDBConnectionConfig, 'url'>,
  ): SurrealDBSaver {
    return new SurrealDBSaver({
      url,
      ...config,
    });
  }

  /**
   * Set up the checkpoint database asynchronously.
   *
   * This method creates the necessary tables in the SurrealDB database if they don't
   * already exist and runs database migrations. It MUST be called directly by the user
   * the first time checkpointer is used.
   */
  async setup(): Promise<void> {
    await initDb(this.connectionConfig);
    const client = await getDb();

    let version = -1;
    const MIGRATIONS = getMigrations();

    try {
      const result = await client.query<[Array<{ v: number }>]>(
        `SELECT v FROM checkpoint_migrations ORDER BY v DESC LIMIT 1`,
      );
      if (result && result[0] && result[0].length > 0) {
        version = result[0][0]?.v ?? -1;
      }
    } catch (error: unknown) {
      // Assume table doesn't exist if there's an error
      version = -1;
    }

    for (let v = version + 1; v < MIGRATIONS.length; v += 1) {
      const migration = MIGRATIONS[v];
      if (!migration) continue;
      await client.query(migration);
      await client.query(`INSERT INTO checkpoint_migrations { v: $v }`, { v });
    }

    this.isSetup = true;
  }

  protected async _loadCheckpoint(
    checkpoint: Omit<Checkpoint, 'pending_sends' | 'channel_values'>,
    channelValues: [Uint8Array, Uint8Array, Uint8Array][],
  ): Promise<Checkpoint> {
    return {
      ...checkpoint,
      channel_values: await this._loadBlobs(channelValues),
    };
  }

  protected async _loadBlobs(
    blobValues: [Uint8Array, Uint8Array, Uint8Array][],
  ): Promise<Record<string, unknown>> {
    if (!blobValues || blobValues.length === 0) {
      return {};
    }
    const textDecoder = new TextDecoder();
    const entries = await Promise.all(
      blobValues
        .filter(([, t]) => textDecoder.decode(t) !== 'empty')
        .map(async ([k, t, v]) => [
          textDecoder.decode(k),
          await this.serde.loadsTyped(textDecoder.decode(t), v),
        ]),
    );
    return Object.fromEntries(entries);
  }

  protected async _loadMetadata(metadata: Record<string, unknown>) {
    const [type, dumpedValue] = await this.serde.dumpsTyped(metadata);
    return this.serde.loadsTyped(type, dumpedValue);
  }

  protected async _loadWrites(
    writes: [Uint8Array, Uint8Array, Uint8Array, Uint8Array][],
  ): Promise<[string, string, unknown][]> {
    const decoder = new TextDecoder();
    return writes
      ? await Promise.all(
          writes.map(async ([tid, channel, t, v]) => [
            decoder.decode(tid),
            decoder.decode(channel),
            await this.serde.loadsTyped(decoder.decode(t), v),
          ]),
        )
      : [];
  }

  protected async _dumpBlobs(
    checkpointRecordId: string,
    values: Record<string, unknown>,
    versions: ChannelVersions,
  ): Promise<
    {
      checkpoint: string;
      channel: string;
      version: string;
      type: string;
      blob: Uint8Array | undefined;
    }[]
  > {
    if (Object.keys(versions).length === 0) {
      return [];
    }

    return Promise.all(
      Object.entries(versions).map(async ([k, ver]) => {
        const [type, value] =
          k in values
            ? await this.serde.dumpsTyped(values[k])
            : ['empty', null];
        return {
          checkpoint: checkpointRecordId,
          channel: k,
          version: ver.toString(),
          type,
          blob: value ? new Uint8Array(value) : undefined,
        };
      }),
    );
  }

  protected _dumpCheckpoint(checkpoint: Checkpoint) {
    const serialized: Record<string, unknown> = { ...checkpoint };
    if ('channel_values' in serialized) delete serialized.channel_values;
    return serialized;
  }

  protected async _dumpMetadata(metadata: CheckpointMetadata) {
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);
    // We need to remove null characters before writing
    return JSON.parse(
      new TextDecoder().decode(serializedMetadata).replace(/\0/g, ''),
    );
  }

  protected async _dumpWrites(
    checkpointRecordId: string,
    taskId: string,
    writes: [string, unknown][],
  ): Promise<
    {
      checkpoint: string;
      task_id: string;
      idx: number;
      channel: string;
      type: string;
      blob: Uint8Array;
    }[]
  > {
    return Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(value);
        return {
          checkpoint: checkpointRecordId,
          task_id: taskId,
          idx: WRITES_IDX_MAP[channel] ?? idx,
          channel,
          type,
          blob: new Uint8Array(serializedValue),
        };
      }),
    );
  }

  /**
   * Return WHERE clause predicates for a given list() config, filter, cursor.
   *
   * This method returns a tuple of a string and parameters object. The string
   * is the parameterized WHERE clause predicate (including the WHERE keyword):
   * "WHERE column1 = $param1 AND column2 = $param2". The parameters object contains
   * the values for each of the corresponding named parameters.
   */
  protected _searchWhere(
    config?: RunnableConfig,
    filter?: Record<string, unknown>,
    before?: RunnableConfig,
  ): [string, Record<string, unknown>] {
    const wheres: string[] = [];
    const params: Record<string, unknown> = {};

    // construct predicate for config filter
    if (config?.configurable?.thread_id) {
      wheres.push(`thread_id = $thread_id`);
      params.thread_id = config.configurable.thread_id;
    }

    // strict checks for undefined/null because empty strings are falsy
    if (
      config?.configurable?.checkpoint_ns !== undefined &&
      config?.configurable?.checkpoint_ns !== null
    ) {
      wheres.push(`checkpoint_ns = $checkpoint_ns`);
      params.checkpoint_ns = config.configurable.checkpoint_ns;
    }

    if (config?.configurable?.checkpoint_id) {
      wheres.push(`checkpoint_id = $checkpoint_id`);
      params.checkpoint_id = config.configurable.checkpoint_id;
    }

    // construct predicate for metadata filter
    // SurrealDB: check if metadata contains all filter fields
    if (filter && Object.keys(filter).length > 0) {
      const filterConditions = Object.entries(filter).map(([key, value]) => {
        const paramKey = `filter_${key}`;
        params[paramKey] = value;
        return `metadata.${key} = $${paramKey}`;
      });
      wheres.push(`(${filterConditions.join(' AND ')})`);
    }

    // construct predicate for `before`
    if (before?.configurable?.checkpoint_id !== undefined) {
      wheres.push(`checkpoint_id < $before_checkpoint_id`);
      params.before_checkpoint_id = before.configurable.checkpoint_id;
    }

    return [wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '', params];
  }

  /**
   * Get a checkpoint tuple from the database.
   * This method retrieves a checkpoint tuple from the SurrealDB database
   * based on the provided config. If the config's configurable field contains
   * a "checkpoint_id" key, the checkpoint with the matching thread_id and
   * namespace is retrieved. Otherwise, the latest checkpoint for the given
   * thread_id is retrieved.
   * @param config The config to use for retrieving the checkpoint.
   * @returns The retrieved checkpoint tuple, or undefined.
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const client = await getDb();
    const {
      thread_id,
      checkpoint_ns = DEFAULT_CHECKPOINT_NS,
      checkpoint_id,
    } = config.configurable ?? {};

    const params: Record<string, unknown> = {
      thread_id,
      checkpoint_ns,
    };

    let where: string;
    if (checkpoint_id) {
      where =
        'WHERE thread_id = $thread_id AND checkpoint_ns = $checkpoint_ns AND checkpoint_id = $checkpoint_id';
      params.checkpoint_id = checkpoint_id;
    } else {
      where =
        'WHERE thread_id = $thread_id AND checkpoint_ns = $checkpoint_ns ORDER BY checkpoint_id DESC LIMIT 1';
    }

    const result = await client.query<[Array<SQL_TYPES['SELECT_SQL']>]>(
      this.SQL_STATEMENTS.SELECT_SQL + where,
      params,
    );

    const row = result?.[0]?.[0];
    if (!row) return undefined;

    // Use the actual record ID from the database (matches what put uses for blobs)
    // Fallback to constructed format for compatibility with putWrites
    const checkpointRecordId =
      row.id ||
      `checkpoints:⟨${row.thread_id},${row.checkpoint_ns},${row.checkpoint_id}⟩`;

    // Fetch related blobs using record link
    const blobsResult = await client.query<
      [
        Array<{
          channel: string;
          type: string;
          blob: Uint8Array | null;
        }>,
      ]
    >(
      `SELECT channel, type, blob FROM checkpoint_blobs WHERE checkpoint = $checkpoint_id`,
      { checkpoint_id: checkpointRecordId },
    );

    // Fetch related writes using record link
    const writesResult = await client.query<
      [
        Array<{
          task_id: string;
          channel: string;
          type: string;
          blob: Uint8Array;
        }>,
      ]
    >(
      `SELECT task_id, idx, channel, type, blob FROM checkpoint_writes WHERE checkpoint = $checkpoint_id ORDER BY task_id ASC, idx ASC`,
      { checkpoint_id: checkpointRecordId },
    );

    // Convert blobs to expected format
    const channelValues: [Uint8Array, Uint8Array, Uint8Array][] = (
      blobsResult?.[0] || []
    )
      .filter((b) => b.blob !== null)
      .map((b) => [
        new TextEncoder().encode(b.channel),
        new TextEncoder().encode(b.type),
        b.blob as Uint8Array,
      ]);

    // Convert writes to expected format
    const pendingWrites: [Uint8Array, Uint8Array, Uint8Array, Uint8Array][] = (
      writesResult?.[0] || []
    ).map(
      (w: {
        task_id: string;
        channel: string;
        type: string;
        blob: Uint8Array;
      }) => [
        new TextEncoder().encode(w.task_id),
        new TextEncoder().encode(w.channel),
        new TextEncoder().encode(w.type),
        w.blob,
      ],
    );

    const checkpoint = await this._loadCheckpoint(
      row.checkpoint,
      channelValues,
    );

    const finalConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: row.checkpoint_id,
      },
    };
    const metadata = await this._loadMetadata(row.metadata);
    const parentConfig = row.parent_checkpoint_id
      ? {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: row.parent_checkpoint_id,
          },
        }
      : undefined;
    const loadedWrites = await this._loadWrites(pendingWrites);

    return {
      config: finalConfig,
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites: loadedWrites,
    };
  }

  /**
   * List checkpoints from the database.
   *
   * This method retrieves a list of checkpoint tuples from the SurrealDB database based
   * on the provided config. The checkpoints are ordered by checkpoint ID in descending order (newest first).
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const client = await getDb();
    const { filter, before, limit } = options ?? {};
    const [where, params] = this._searchWhere(config, filter, before);
    let query = `${this.SQL_STATEMENTS.SELECT_SQL}${where} ORDER BY checkpoint_id DESC`;
    if (limit !== undefined) {
      query += ` LIMIT ${Number.parseInt(limit.toString(), 10)}`; // sanitize via parseInt, as limit could be an externally provided value
    }

    const result = await client.query<[Array<SQL_TYPES['SELECT_SQL']>]>(
      query,
      params,
    );
    const rows = result?.[0] || [];

    for (const value of rows) {
      // Use the actual record ID from the database (matches what put uses for blobs)
      // Fallback to constructed format for compatibility
      const checkpointRecordId =
        value.id ||
        `checkpoints:⟨${value.thread_id},${value.checkpoint_ns},${value.checkpoint_id}⟩`;

      // Fetch related blobs
      const blobsResult = await client.query<
        [
          Array<{
            channel: string;
            type: string;
            blob: Uint8Array | null;
          }>,
        ]
      >(
        `SELECT channel, type, blob FROM checkpoint_blobs WHERE checkpoint = $checkpoint_id`,
        { checkpoint_id: checkpointRecordId },
      );

      // Fetch related writes
      const writesResult = await client.query<
        [
          Array<{
            task_id: string;
            channel: string;
            type: string;
            blob: Uint8Array;
          }>,
        ]
      >(
        `SELECT task_id, idx, channel, type, blob FROM checkpoint_writes WHERE checkpoint = $checkpoint_id ORDER BY task_id ASC, idx ASC`,
        { checkpoint_id: checkpointRecordId },
      );

      // Convert blobs to expected format
      const channelValues: [Uint8Array, Uint8Array, Uint8Array][] = (
        blobsResult?.[0] || []
      )
        .filter((b) => b.blob !== null)
        .map((b) => [
          new TextEncoder().encode(b.channel),
          new TextEncoder().encode(b.type),
          b.blob as Uint8Array,
        ]);

      // Convert writes to expected format
      const pendingWrites: [Uint8Array, Uint8Array, Uint8Array, Uint8Array][] =
        (writesResult?.[0] || []).map(
          (w: {
            task_id: string;
            channel: string;
            type: string;
            blob: Uint8Array;
          }) => [
            new TextEncoder().encode(w.task_id),
            new TextEncoder().encode(w.channel),
            new TextEncoder().encode(w.type),
            w.blob,
          ],
        );

      yield {
        config: {
          configurable: {
            thread_id: value.thread_id,
            checkpoint_ns: value.checkpoint_ns,
            checkpoint_id: value.checkpoint_id,
          },
        },
        checkpoint: await this._loadCheckpoint(value.checkpoint, channelValues),
        metadata: await this._loadMetadata(value.metadata),
        parentConfig: value.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: value.thread_id,
                checkpoint_ns: value.checkpoint_ns,
                checkpoint_id: value.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites: await this._loadWrites(pendingWrites),
      };
    }
  }

  /**
   * Save a checkpoint to the database.
   *
   * This method saves a checkpoint to the SurrealDB database. The checkpoint is associated
   * with the provided config and its parent config (if any).
   * @param config
   * @param checkpoint
   * @param metadata
   * @returns
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    if (config.configurable === undefined) {
      throw new Error(`Missing "configurable" field in "config" param`);
    }
    const {
      thread_id,
      checkpoint_ns = DEFAULT_CHECKPOINT_NS,
      checkpoint_id,
    } = config.configurable;

    const nextConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };

    const client = await getDb();
    const serializedCheckpoint = this._dumpCheckpoint(checkpoint);

    // First, insert/update the checkpoint to get its record ID
    const checkpointResult = await client.query<[Array<{ id: string }>]>(
      this.SQL_STATEMENTS.UPSERT_CHECKPOINTS_SQL,
      {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
        parent_checkpoint_id: checkpoint_id || undefined, // Use undefined for optional fields in SurrealDB
        checkpoint: serializedCheckpoint,
        metadata: await this._dumpMetadata(metadata),
      },
    );

    // Get the checkpoint record ID (for inserts it's in result, for updates we construct it)
    const checkpointRecordId =
      checkpointResult?.[0]?.[0]?.id ||
      `checkpoints:⟨${thread_id},${checkpoint_ns},${checkpoint.id}⟩`;

    // Now insert/update blobs with the checkpoint record link
    const serializedBlobs = await this._dumpBlobs(
      checkpointRecordId,
      checkpoint.channel_values,
      newVersions,
    );

    for (const blob of serializedBlobs) {
      await client.query(this.SQL_STATEMENTS.UPSERT_CHECKPOINT_BLOBS_SQL, {
        checkpoint_id: blob.checkpoint, // Already a full record ID string
        channel: blob.channel,
        version: blob.version,
        type: blob.type,
        blob: blob.blob,
      });
    }

    return nextConfig;
  }

  /**
   * Store intermediate writes linked to a checkpoint.
   *
   * This method saves intermediate writes associated with a checkpoint to the SurrealDB database.
   * @param config Configuration of the related checkpoint.
   * @param writes List of writes to store.
   * @param taskId Identifier for the task creating the writes.
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const query = writes.every((w) => w[0] in WRITES_IDX_MAP)
      ? this.SQL_STATEMENTS.UPSERT_CHECKPOINT_WRITES_SQL
      : this.SQL_STATEMENTS.INSERT_CHECKPOINT_WRITES_SQL;

    // Get checkpoint record ID from config
    const {
      thread_id,
      checkpoint_ns = DEFAULT_CHECKPOINT_NS,
      checkpoint_id,
    } = config.configurable ?? {};

    const client = await getDb();

    // Query for the actual checkpoint record ID to match what put uses
    const checkpointResult = await client.query<[Array<{ id: string }>]>(
      `SELECT id FROM checkpoints WHERE thread_id = $thread_id AND checkpoint_ns = $checkpoint_ns AND checkpoint_id = $checkpoint_id LIMIT 1`,
      { thread_id, checkpoint_ns, checkpoint_id },
    );

    // Use actual record ID if found, otherwise fallback to constructed format
    const checkpointRecordId =
      checkpointResult?.[0]?.[0]?.id ||
      `checkpoints:⟨${thread_id},${checkpoint_ns},${checkpoint_id}⟩`;

    const dumpedWrites = await this._dumpWrites(
      checkpointRecordId,
      taskId,
      writes,
    );
    for (const write of dumpedWrites) {
      await client.query(query, {
        checkpoint_id: write.checkpoint, // Already a full record ID string
        task_id: write.task_id,
        idx: write.idx,
        channel: write.channel,
        type: write.type,
        blob: write.blob,
      });
    }
  }

  async end() {
    return closeDb();
  }

  async deleteThread(threadId: string): Promise<void> {
    const client = await getDb();
    await client.query(this.SQL_STATEMENTS.DELETE_CHECKPOINT_BLOBS_SQL, {
      thread_id: threadId,
    });
    await client.query(this.SQL_STATEMENTS.DELETE_CHECKPOINTS_SQL, {
      thread_id: threadId,
    });
    await client.query(this.SQL_STATEMENTS.DELETE_CHECKPOINT_WRITES_SQL, {
      thread_id: threadId,
    });
  }
}
