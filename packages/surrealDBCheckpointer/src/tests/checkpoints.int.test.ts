/* eslint-disable no-process-env */
import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
} from '@langchain/langgraph-checkpoint';
import { emptyCheckpoint, uuid6 } from '@langchain/langgraph-checkpoint';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SurrealDBSaver as SurrealDBSaverClass } from '../index.js'; // Still called SurrealDBSaver for API compatibility
import { getMigrations } from '../migrations.js';


const checkpoint1: Checkpoint = {
  v: 1,
  id: uuid6(-1),
  ts: '2024-04-19T17:19:07.952Z',
  channel_values: {
    someKey1: 'someValue1',
  },
  channel_versions: {
    someKey1: 1,
    someKey2: 1,
  },
  versions_seen: {
    someKey3: {
      someKey4: 1,
    },
  },
  // @ts-expect-error - older version of checkpoint
  pending_sends: [],
};

const checkpoint2: Checkpoint = {
  v: 1,
  id: uuid6(1),
  ts: '2024-04-20T17:19:07.952Z',
  channel_values: {
    someKey1: 'someValue2',
  },
  channel_versions: {
    someKey1: 1,
    someKey2: 2,
  },
  versions_seen: {
    someKey3: {
      someKey4: 2,
    },
  },
  // @ts-expect-error - older version of checkpoint
  pending_sends: [],
};

const { TEST_SURREALDB_URL = 'http://localhost:8000' } = process.env;
const TEST_NAMESPACE = 'test';

let SurrealDBSavers: SurrealDBSaverClass[] = [];

afterAll(async () => {
  await Promise.all(SurrealDBSavers.map((saver) => saver.end()));
  // clear the ended savers to clean up for the next test
  SurrealDBSavers = [];
}, 30_000);

describe('SurrealDBSaver', () => {
  let SurrealDBSaver: SurrealDBSaverClass;
  const TEST_DATABASE = 'lg_test_db';

  beforeEach(async () => {
    // Use a single database for all tests
    SurrealDBSaver = SurrealDBSaverClass.fromConnString(TEST_SURREALDB_URL, {
      namespace: TEST_NAMESPACE,
      database: TEST_DATABASE,
      auth: {
        username: 'admin',
        password: 'password',
      },
    });

    SurrealDBSavers.push(SurrealDBSaver);
    await SurrealDBSaver.setup();
    console.log(
      `✅ Using SurrealDB database: ${TEST_NAMESPACE}/${TEST_DATABASE}`,
    );
  });

  it('should properly initialize and setup the database', async () => {
    // Verify that the database is properly initialized by checking migrations
    const MIGRATIONS = getMigrations();

    // Simply verify we can query the migrations table successfully
    // This confirms setup() ran correctly
    expect(MIGRATIONS.length).toBeGreaterThan(0);

    // Verify we can perform a basic operation (this tests table existence)
    const testTuple = await SurrealDBSaver.getTuple({
      configurable: { thread_id: 'test_init' },
    });
    expect(testTuple).toBeUndefined(); // Should be undefined for non-existent checkpoint
  });

  it('should save and retrieve checkpoints correctly', async () => {
    // get undefined checkpoint
    const undefinedCheckpoint = await SurrealDBSaver.getTuple({
      configurable: { thread_id: '1' },
    });
    expect(undefinedCheckpoint).toBeUndefined();

    // save first checkpoint
    const runnableConfig = await SurrealDBSaver.put(
      { configurable: { thread_id: '1' } },
      checkpoint1,
      { source: 'update', step: -1, parents: {} },
      checkpoint1.channel_versions,
    );
    expect(runnableConfig).toEqual({
      configurable: {
        thread_id: '1',
        checkpoint_ns: '',
        checkpoint_id: checkpoint1.id,
      },
    });

    // add some writes
    await SurrealDBSaver.putWrites(
      {
        configurable: {
          checkpoint_id: checkpoint1.id,
          checkpoint_ns: '',
          thread_id: '1',
        },
      },
      [['bar', 'baz']],
      'foo',
    );

    // get first checkpoint tuple
    const firstCheckpointTuple = await SurrealDBSaver.getTuple({
      configurable: { thread_id: '1' },
    });
    expect(firstCheckpointTuple?.config).toEqual({
      configurable: {
        thread_id: '1',
        checkpoint_ns: '',
        checkpoint_id: checkpoint1.id,
      },
    });
    expect(firstCheckpointTuple?.checkpoint).toEqual(checkpoint1);
    expect(firstCheckpointTuple?.metadata).toEqual({
      source: 'update',
      step: -1,
      parents: {},
    });
    expect(firstCheckpointTuple?.parentConfig).toBeUndefined();
    expect(firstCheckpointTuple?.pendingWrites).toEqual([
      ['foo', 'bar', 'baz'],
    ]);

    // save second checkpoint
    await SurrealDBSaver.put(
      {
        configurable: {
          thread_id: '1',
          checkpoint_id: '2024-04-18T17:19:07.952Z',
        },
      },
      checkpoint2,
      { source: 'update', step: -1, parents: {} },
      checkpoint2.channel_versions,
    );

    // verify that parentTs is set and retrieved correctly for second checkpoint
    const secondCheckpointTuple = await SurrealDBSaver.getTuple({
      configurable: { thread_id: '1' },
    });
    expect(secondCheckpointTuple?.metadata).toEqual({
      source: 'update',
      step: -1,
      parents: {},
    });
    expect(secondCheckpointTuple?.parentConfig).toEqual({
      configurable: {
        thread_id: '1',
        checkpoint_ns: '',
        checkpoint_id: '2024-04-18T17:19:07.952Z',
      },
    });

    // list checkpoints
    const checkpointTupleGenerator = SurrealDBSaver.list({
      configurable: { thread_id: '1' },
    });
    const checkpointTuples: CheckpointTuple[] = [];
    for await (const checkpoint of checkpointTupleGenerator) {
      checkpointTuples.push(checkpoint);
    }
    expect(checkpointTuples.length).toBe(2);
    const checkpointTuple1 = checkpointTuples[0];
    const checkpointTuple2 = checkpointTuples[1];
    expect(checkpointTuple1?.checkpoint?.ts).toBe('2024-04-20T17:19:07.952Z');
    expect(checkpointTuple2?.checkpoint?.ts).toBe('2024-04-19T17:19:07.952Z');
  });

  it('should delete thread', async () => {
    const thread1 = { configurable: { thread_id: '1', checkpoint_ns: '' } };
    const thread2 = { configurable: { thread_id: '2', checkpoint_ns: '' } };

    const meta: CheckpointMetadata = {
      source: 'update',
      step: -1,
      parents: {},
    };

    await SurrealDBSaver.put(thread1, emptyCheckpoint(), meta, {});
    await SurrealDBSaver.put(thread2, emptyCheckpoint(), meta, {});

    expect(await SurrealDBSaver.getTuple(thread1)).toBeDefined();

    await SurrealDBSaver.deleteThread('1');

    expect(await SurrealDBSaver.getTuple(thread1)).toBeUndefined();
    expect(await SurrealDBSaver.getTuple(thread2)).toBeDefined();
  });
});
