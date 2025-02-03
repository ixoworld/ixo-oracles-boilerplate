import { type PendingWrite, uuid6 } from '@langchain/langgraph-checkpoint';
import { MatrixCheckpointSaver } from 'src/checkpointer';
import { type IRunnableConfigWithRequiredFields } from 'src/checkpointer/types';
import { CONFIG, initialCheckpointTuple } from '../utils';

export const putWritesTestCases = (): void => {
  let threadId: string;
  let checkpointId: string;
  let taskId: string;
  const mxSaver = new MatrixCheckpointSaver('guru');

  describe.each(['root', 'child'])('namespace: %s', (namespace) => {
    const checkpointNs = namespace === 'root' ? '' : namespace;

    describe('Success cases', () => {
      let writes: PendingWrite[];
      let returnedConfig: Awaited<ReturnType<MatrixCheckpointSaver['put']>>;
      beforeEach(async () => {
        threadId = uuid6(-3);
        checkpointId = uuid6(-3);
        taskId = uuid6(-3);

        const { checkpoint, metadata } = initialCheckpointTuple({
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
        });
        writes = [['channel1', { value: 'value1' }]];

        returnedConfig = await mxSaver.put(
          {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              configs: CONFIG.configurable.configs,
            },
          },
          checkpoint,
          metadata,
          {} /* not sure what to do about newVersions, as it's unused */,
        );

        // Execute putWrites
        await mxSaver.putWrites(
          {
            configurable: {
              thread_id: returnedConfig.configurable.thread_id,
              checkpoint_ns: returnedConfig.configurable.checkpoint_ns,
              checkpoint_id: returnedConfig.configurable.checkpoint_id,
              configs: CONFIG.configurable.configs,
            },
          },
          writes,
          taskId,
        );
      });

      it('should successfully store writes that can be retrieved', async () => {
        const tuple = await mxSaver.getTuple({
          configurable: {
            thread_id: returnedConfig.configurable.thread_id,
            checkpoint_ns: returnedConfig.configurable.checkpoint_ns,
            checkpoint_id: returnedConfig.configurable.checkpoint_id,
            configs: CONFIG.configurable.configs,
          },
        });
        expect(tuple).toBeDefined();
        expect(tuple?.pendingWrites).toBeDefined();
        expect(tuple?.pendingWrites).toEqual([
          [taskId, 'channel1', { value: 'value1' }],
        ]);
      });
    });

    describe('failure cases', () => {
      const writes: PendingWrite[] = [['channel1', 'value1']];
      taskId = uuid6(-3);

      it('should fail if config.configurable is missing', async () => {
        await expect(async () =>
          mxSaver.putWrites(
            {
              configurable: {
                configs: CONFIG.configurable.configs,
              },
            } as IRunnableConfigWithRequiredFields,
            writes,
            taskId,
          ),
        ).rejects.toThrow();
      });

      it('should fail if thread_id is missing', async () => {
        await expect(async () =>
          mxSaver.putWrites(
            {
              configurable: {
                checkpoint_ns: checkpointNs,
                checkpoint_id: uuid6(-3),
                configs: CONFIG.configurable.configs,
              },
            } as IRunnableConfigWithRequiredFields,
            writes,
            taskId,
          ),
        ).rejects.toThrow();
      });

      it('should fail if configs is missing', async () => {
        await expect(async () =>
          mxSaver.putWrites(
            {
              configurable: {
                thread_id: uuid6(-3),
                checkpoint_ns: checkpointNs,
                checkpoint_id: uuid6(-3),
              },
            } as IRunnableConfigWithRequiredFields,
            writes,
            taskId,
          ),
        ).rejects.toThrow();
      });
    });
  });
};
