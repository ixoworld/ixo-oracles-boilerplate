import { HumanMessage } from '@langchain/core/messages';
import { logger } from 'matrix-js-sdk/lib/logger';
import crypto from 'node:crypto';
import { type IRunnableConfigWithRequiredFields } from 'src/checkpointer/types';
import { MatrixManager } from 'src/matrix-manager';
import {
  type CleanupFunction,
  createRoomForUser,
  createTestUser,
  prepareTest,
} from '../../test-utils';
import { InMemoryJsonStorage } from '../../test-utils/in-memory-storage';
import { getTupleTestCases } from './suits/get-tuple';
import { putTestCases } from './suits/put';
import { putWritesTestCases } from './suits/put-writes';
import { testGraph } from './test-graph/test-graph';
import { CONFIG } from './utils';

describe('Matrix Checkpointer', () => {
  const manager = MatrixManager.getInstance();
  let cleanup: CleanupFunction;
  let testUser: { userId: string; accessToken: string; deviceId: string };
  const oracleName = 'guru';

  beforeAll(async () => {
    logger.disableAll();

    jest.mock('src/local-storage/local-storage', () => ({
      default: InMemoryJsonStorage,
      LocalJsonStorage: InMemoryJsonStorage,
    }));
    cleanup = await prepareTest(manager);
    testUser = await createTestUser('checkpointer-test');
    const testRoom = await createRoomForUser(manager, testUser, oracleName);

    CONFIG.configurable.configs.matrix.roomId = testRoom.roomId;
    CONFIG.configurable.configs.user.did = testUser.userId;
    process.env.SKIP_LOGGING_CHAT_HISTORY_TO_MATRIX = 'true';
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('#put', () => {
    putTestCases();
  });

  describe('#putWrites', () => {
    putWritesTestCases();
  });

  describe('#getTuple', () => {
    getTupleTestCases();
  });

  describe('Graph Integration', () => {
    const sessionId = crypto.randomUUID();
    const config: IRunnableConfigWithRequiredFields = {
      configurable: {
        thread_id: sessionId,
        configs: CONFIG.configurable.configs,
      },
    };

    it('should maintain state across multiple messages', async () => {
      // First message
      await testGraph.invoke(
        {
          messages: [new HumanMessage('First')],
        },
        config,
      );

      // Second message
      const result2 = await testGraph.invoke(
        {
          messages: [new HumanMessage('Second')],
        },
        config,
      );

      // Verify message history is maintained
      expect(result2.messages).toHaveLength(4);
      expect(result2.messages.map((m) => m.content)).toEqual([
        'First',
        'AI-First',
        'Second',
        'AI-Second',
      ]);

      // Verify docs are accumulated
      expect(result2.docs).toHaveLength(2);
      expect(result2.docs).toEqual(['doc-First', 'doc-Second']);
    });
  });
});
