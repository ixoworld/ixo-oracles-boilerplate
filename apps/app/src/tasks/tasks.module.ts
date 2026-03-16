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

import { QUEUE_DEFAULT_OPTIONS, QUEUE_NAMES } from './scheduler/task-queues';
import { TasksScheduler } from './scheduler/tasks-scheduler.service';
import { TasksService } from './task.service';
import { MainAgentGraph } from 'src/graph';
import { SimpleProcessor } from './processors/simple.processor';
import { WorkProcessor } from './processors/work.processor';
import { DeliverProcessor } from './processors/deliver.processor';

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
  ],
  exports: [TasksScheduler, TasksService],
})
export class TasksModule {}
