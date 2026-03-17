/**
 * TasksModule — Registers BullMQ queues, workers, and task services.
 *
 * Uses @nestjs/bullmq for NestJS integration. Redis connection is shared
 * via the REDIS_URL environment variable.
 *
 * Note: Redis should be configured with AOF persistence for job durability
 * across restarts. BullMQ resumes delayed/repeatable jobs automatically
 * from Redis on boot.
 *
 * @see spec §26.1 — Module Structure
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ENV } from 'src/types';

import { MemoryEngineService, SessionManagerService } from '@ixo/common';
import { MatrixManager } from '@ixo/matrix';
import { MainAgentGraph } from 'src/graph';
import { CheckpointStorageSyncModule } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.module';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { DeliverProcessor } from './processors/deliver.processor';
import { SimpleProcessor } from './processors/simple.processor';
import { WorkProcessor } from './processors/work.processor';
import { QUEUE_DEFAULT_OPTIONS, QUEUE_NAMES } from './scheduler/task-queues';
import { TasksScheduler } from './scheduler/tasks-scheduler.service';
import { TasksService } from './task.service';

@Module({
  imports: [
    // Register BullMQ with Redis connection from env
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ENV>) => ({
        connection: {
          url: config.getOrThrow('REDIS_URL'),
          maxRetriesPerRequest: null, // Required for BullMQ workers
          enableReadyCheck: true,
        },
      }),
    }),

    // Register the three task queues
    BullModule.registerQueue({
      name: QUEUE_NAMES.SIMPLE,
      defaultJobOptions: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SIMPLE],
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.WORK,
      defaultJobOptions: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.WORK],
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.DELIVER,
      defaultJobOptions: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.DELIVER],
    }),

    // Register FlowProducer for one-shot Pattern B jobs
    BullModule.registerFlowProducer({ name: 'task-flow' }),

    // Provides UserMatrixSqliteSyncService for SessionManagerService
    CheckpointStorageSyncModule,
  ],
  providers: [
    TasksScheduler,
    TasksService,
    SimpleProcessor,
    WorkProcessor,
    DeliverProcessor,
    {
      provide: 'MAIN_AGENT_GRAPH',
      useFactory: () => new MainAgentGraph(),
    },

    {
      provide: MemoryEngineService,
      useFactory: (configService: ConfigService<ENV>) => {
        const memoryEngineUrl =
          configService.getOrThrow<string>('MEMORY_ENGINE_URL');
        return new MemoryEngineService(memoryEngineUrl);
      },
      inject: [ConfigService],
    },
    {
      provide: SessionManagerService,
      useFactory: (
        syncService: UserMatrixSqliteSyncService,
        memoryEngineService: MemoryEngineService,
      ) => {
        return new SessionManagerService(
          syncService,
          MatrixManager.getInstance(),
          memoryEngineService,
        );
      },
      inject: [UserMatrixSqliteSyncService, MemoryEngineService],
    },
  ],
  exports: [TasksScheduler, TasksService],
})
export class TasksModule {}
