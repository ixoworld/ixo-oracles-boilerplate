import {
  type CheckpointTuple,
  type PendingWrite,
  TASKS,
  uuid6,
} from '@langchain/langgraph-checkpoint';
import { MatrixCheckpointSaver } from 'src/checkpointer';
import {
  CONFIG,
  parentAndChildCheckpointTuplesWithWrites,
  putTuples,
} from '../utils';

export function getTupleTestCases(): void {
  describe(`#getTuple`, () => {
    const mxSaver = new MatrixCheckpointSaver('guru');

    describe.each(['root', 'child'])('namespace: %s', (namespace) => {
      let threadId: string;
      const checkpointNs = namespace === 'root' ? '' : namespace;

      let parentCheckpointId: string;
      let childCheckpointId: string;

      let generatedParentTuple: CheckpointTuple;
      let generatedChildTuple: CheckpointTuple;

      let parentTuple: CheckpointTuple | undefined;
      let childTuple: CheckpointTuple | undefined;
      let latestTuple: CheckpointTuple | undefined;

      beforeAll(async () => {
        threadId = uuid6(-3);
        parentCheckpointId = uuid6(-3);
        childCheckpointId = uuid6(-3);

        const writesToParent = [
          {
            taskId: 'pending_sends_task',
            writes: [[TASKS, ['add_fish']]] as PendingWrite[],
          },
        ];

        const writesToChild = [
          {
            taskId: 'add_fish',
            writes: [['animals', ['dog', 'fish']]] as PendingWrite[],
          },
        ];

        ({ parent: generatedParentTuple, child: generatedChildTuple } =
          parentAndChildCheckpointTuplesWithWrites({
            thread_id: threadId,
            parentCheckpointId,
            childCheckpointId,
            checkpoint_ns: checkpointNs,
            initialChannelValues: {
              animals: ['dog'],
            },
            writesToParent,
            writesToChild,
          }));

        const storedTuples = putTuples(mxSaver, [
          {
            tuple: generatedParentTuple,
            writes: writesToParent,
            newVersions: { animals: 1 },
          },
          {
            tuple: generatedChildTuple,
            writes: writesToChild,
            newVersions: { animals: 2 },
          },
        ]);

        parentTuple = (await storedTuples.next()).value as CheckpointTuple;
        childTuple = (await storedTuples.next()).value as CheckpointTuple;

        latestTuple = await mxSaver.getTuple({
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            configs: CONFIG.configurable.configs,
          },
        });
      });

      describe('success cases', () => {
        describe('when checkpoint_id is provided', () => {
          describe('first checkpoint', () => {
            it('should return a tuple containing the checkpoint without modification', () => {
              expect(parentTuple).not.toBeUndefined();
              expect(parentTuple?.checkpoint).toEqual(
                generatedParentTuple.checkpoint,
              );
            });

            it("should return a tuple containing the checkpoint's metadata without modification", () => {
              expect(parentTuple?.metadata).not.toBeUndefined();
              expect(parentTuple?.metadata).toEqual(
                generatedParentTuple.metadata,
              );
            });

            it('should return a tuple containing a config object that has the correct thread_id, checkpoint_ns, and checkpoint_id', () => {
              expect(parentTuple?.config).not.toBeUndefined();

              expect(parentTuple?.config).toEqual({
                configurable: {
                  thread_id: threadId,
                  checkpoint_ns: checkpointNs,
                  checkpoint_id: parentCheckpointId,
                  configs: CONFIG.configurable.configs,
                },
              });
            });

            it('should return a tuple containing an undefined parentConfig', () => {
              expect(parentTuple?.parentConfig).toBeUndefined();
            });

            it('should return a tuple containing the writes against the checkpoint', () => {
              expect(parentTuple?.pendingWrites).toEqual([
                ['pending_sends_task', TASKS, ['add_fish']],
              ]);
            });
          });

          describe('subsequent checkpoints', () => {
            it(`should return a tuple containing the checkpoint`, async () => {
              expect(childTuple).not.toBeUndefined();
              expect(childTuple?.checkpoint).toEqual(
                generatedChildTuple.checkpoint,
              );
            });

            it("should return a tuple containing the checkpoint's metadata without modification", () => {
              expect(childTuple?.metadata).not.toBeUndefined();
              expect(childTuple?.metadata).toEqual(
                generatedChildTuple.metadata,
              );
            });

            it('should return a tuple containing a config object that has the correct thread_id, checkpoint_ns, and checkpoint_id', () => {
              expect(childTuple?.config).not.toBeUndefined();
              expect(childTuple?.config).toEqual({
                configurable: {
                  thread_id: threadId,
                  checkpoint_ns: checkpointNs,
                  checkpoint_id: childCheckpointId,
                  configs: CONFIG.configurable.configs,
                },
              });
            });

            it('should return a tuple containing a parentConfig with the correct thread_id, checkpoint_ns, and checkpoint_id', () => {
              expect(childTuple?.parentConfig).toEqual({
                configurable: {
                  thread_id: threadId,
                  checkpoint_ns: checkpointNs,
                  checkpoint_id: parentCheckpointId,
                },
              });
            });

            it('should return a tuple containing the writes against the checkpoint', () => {
              expect(childTuple?.pendingWrites).toEqual([
                ['add_fish', 'animals', ['dog', 'fish']],
              ]);
            });
          });
        });

        describe('when checkpoint_id is not provided', () => {
          it(`should return a tuple containing the latest checkpoint`, async () => {
            expect(latestTuple).not.toBeUndefined();
            expect(latestTuple?.checkpoint).toEqual(
              generatedChildTuple.checkpoint,
            );
          });

          it("should return a tuple containing the latest checkpoint's metadata without modification", () => {
            expect(latestTuple?.metadata).not.toBeUndefined();
            expect(latestTuple?.metadata).toEqual(generatedChildTuple.metadata);
          });

          it('should return a tuple containing a config object that has the correct thread_id, checkpoint_ns, and checkpoint_id for the latest checkpoint', () => {
            expect(latestTuple?.config).not.toBeUndefined();
            expect({
              configurable: {
                thread_id: `${latestTuple?.config.configurable?.thread_id}`,
                checkpoint_ns: `${latestTuple?.config.configurable?.checkpoint_ns}`,
                checkpoint_id: `${latestTuple?.config.configurable?.checkpoint_id}`,
                configs: CONFIG.configurable.configs,
              },
            }).toEqual({
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: childCheckpointId,
                configs: CONFIG.configurable.configs,
              },
            });
          });

          it("should return a tuple containing a parentConfig with the correct thread_id, checkpoint_ns, and checkpoint_id for the latest checkpoint's parent", () => {
            expect(latestTuple?.parentConfig).toEqual({
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: parentCheckpointId,
              },
            });
          });
        });
      });

      describe('failure cases', () => {
        it('should return undefined if the checkpoint_id is not found', async () => {
          const configWithInvalidCheckpointId = {
            configurable: {
              thread_id: uuid6(-3),
              checkpoint_ns: checkpointNs,
              checkpoint_id: uuid6(-3),
              configs: CONFIG.configurable.configs,
            },
          };
          const checkpointTuple = await mxSaver.getTuple(
            configWithInvalidCheckpointId,
          );
          expect(checkpointTuple).toBeUndefined();
        });

        it('should return undefined if the thread_id is undefined', async () => {
          const missingThreadIdConfig = {
            configurable: {
              checkpoint_ns: checkpointNs,
              configs: CONFIG.configurable.configs,
            },
          };

          expect(await mxSaver.getTuple(missingThreadIdConfig)).toBeUndefined();
        });

        it('should fail if configurable.configs is missing', async () => {
          await expect(async () =>
            mxSaver.getTuple({
              configurable: {},
            }),
          ).rejects.toThrow();
        });
      });
    });
  });
}
