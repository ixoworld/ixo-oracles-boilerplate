import { type RunnableConfig } from '@langchain/core/runnables';
import {
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  uuid6,
} from '@langchain/langgraph-checkpoint';
import { MatrixCheckpointSaver } from 'src/checkpointer';
import { CONFIG, initialCheckpointTuple } from '../utils';

export const putTestCases = (): void => {
  let threadId: string;
  let checkpointId1: string;
  const mxSaver = new MatrixCheckpointSaver('guru');
  describe.each(['root', 'child'])('namespace: %s', (namespace) => {
    const checkpointNs = namespace === 'root' ? '' : namespace;
    let checkpointStoredWithoutIdInConfig: Checkpoint;
    let metadataStoredWithoutIdInConfig: CheckpointMetadata;

    describe('Success cases', () => {
      let basicPutReturnedConfig: RunnableConfig;
      let basicPutRoundTripTuple: CheckpointTuple | undefined;

      beforeEach(async () => {
        threadId = uuid6(-3);
        checkpointId1 = uuid6(-3);
        ({
          checkpoint: checkpointStoredWithoutIdInConfig,
          metadata: metadataStoredWithoutIdInConfig,
        } = initialCheckpointTuple({
          thread_id: threadId,
          checkpoint_id: checkpointId1,
          checkpoint_ns: checkpointNs,
        }));

        // set up
        // call put without the `checkpoint_id` in the config
        basicPutReturnedConfig = await mxSaver.put(
          {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              // adding this to ensure that additional fields are not stored in the checkpoint tuple
              canary: 'tweet',
              configs: CONFIG.configurable.configs,
            },
          },
          checkpointStoredWithoutIdInConfig,
          metadataStoredWithoutIdInConfig,
          {},
        );

        const {
          thread_id: basicPutReturnedConfigThreadId,
          checkpoint_ns: basicPutReturnedConfigCheckpointNs,
          checkpoint_id: basicPutReturnedConfigCheckpointId,
        } = (basicPutReturnedConfig.configurable ?? {}) as {
          thread_id: string;
          checkpoint_ns: string;
          checkpoint_id: string;
        };

        basicPutRoundTripTuple = await mxSaver.getTuple({
          configurable: {
            thread_id: basicPutReturnedConfigThreadId,
            checkpoint_ns: basicPutReturnedConfigCheckpointNs,
            checkpoint_id: basicPutReturnedConfigCheckpointId,
            configs: CONFIG.configurable.configs,
          },
        });
      });

      it("should return a config with a 'configurable' property", () => {
        expect(basicPutReturnedConfig.configurable).toBeDefined();
      });
      it('should result in a retrievable checkpoint tuple', () => {
        expect(basicPutRoundTripTuple).not.toBeUndefined();
      });
      it('should store the checkpoint without alteration', () => {
        expect(basicPutRoundTripTuple?.checkpoint).toEqual(
          checkpointStoredWithoutIdInConfig,
        );
      });
      it('should store the metadata without alteration', () => {
        expect(basicPutRoundTripTuple?.metadata).toEqual(
          metadataStoredWithoutIdInConfig,
        );
      });

      it('should return a config with only thread_id, checkpoint_ns, and checkpoint_id in the configurable', () => {
        expect(Object.keys(basicPutReturnedConfig.configurable ?? {})).toEqual(
          expect.arrayContaining([
            'thread_id',
            'checkpoint_ns',
            'checkpoint_id',
          ]),
        );
      });
      it('should return config with matching thread_id', () => {
        expect(basicPutReturnedConfig.configurable?.thread_id).toEqual(
          threadId,
        );
      });

      it('should return config with matching checkpoint_id', () => {
        expect(basicPutReturnedConfig.configurable?.checkpoint_id).toEqual(
          checkpointStoredWithoutIdInConfig.id,
        );
      });

      it('should return config with matching checkpoint_ns', () => {
        expect(basicPutReturnedConfig.configurable?.checkpoint_ns).toEqual(
          checkpointNs,
        );
      });
    });

    describe('failure cases', () => {
      it('should fail if config.configurable is missing', async () => {
        await expect(async () =>
          mxSaver.put(
            {
              configurable: {},
            },
            checkpointStoredWithoutIdInConfig,
            metadataStoredWithoutIdInConfig,
            {},
          ),
        ).rejects.toThrow();
      });

      it('should fail if the thread_id is missing', async () => {
        await expect(async () =>
          mxSaver.put(
            {
              configurable: {
                checkpoint_ns: checkpointNs,
                configs: CONFIG.configurable.configs,
              },
            },
            checkpointStoredWithoutIdInConfig,
            metadataStoredWithoutIdInConfig,
            {},
          ),
        ).rejects.toThrow();
      });
    });
  });
};
