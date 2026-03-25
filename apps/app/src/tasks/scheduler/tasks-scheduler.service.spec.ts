import { Test } from '@nestjs/testing';
import { getFlowProducerToken, getQueueToken } from '@nestjs/bullmq';

import { QUEUE_NAMES } from './task-queues';
import type { DeliverJobData, SimpleJobData, WorkJobData } from './types';
import { TasksScheduler } from './tasks-scheduler.service';

// ── Mock Factories ───────────────────────────────────────────────────

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    getJob: vi.fn().mockResolvedValue(null),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(true),
  };
}

function createMockFlowProducer() {
  return {
    add: vi.fn().mockResolvedValue({
      job: { id: 'mock-deliver-id' },
      children: [{ job: { id: 'mock-work-id' } }],
    }),
  };
}

// ── Test Data ────────────────────────────────────────────────────────

const simpleData: SimpleJobData = {
  taskId: 'task_abc123',
  userDid: 'did:ixo:ixo1abc',
  matrixUserId: '@did-ixo-ixo1abc:ixo.world',
  roomId: '!room:ixo.world',
  message: 'Reminder: Submit the report',
};

const workData: WorkJobData = {
  taskId: 'task_abc123',
  userDid: 'did:ixo:ixo1abc',
  roomId: '!room:ixo.world',
};

const deliverData: DeliverJobData = {
  taskId: 'task_abc123',
  userDid: 'did:ixo:ixo1abc',
  matrixUserId: '@did-ixo-ixo1abc:ixo.world',
  roomId: '!room:ixo.world',
};

// ── Tests ────────────────────────────────────────────────────────────

describe('TasksScheduler', () => {
  let scheduler: TasksScheduler;
  let simpleQueue: ReturnType<typeof createMockQueue>;
  let workQueue: ReturnType<typeof createMockQueue>;
  let deliverQueue: ReturnType<typeof createMockQueue>;
  let flowProducer: ReturnType<typeof createMockFlowProducer>;

  beforeEach(async () => {
    simpleQueue = createMockQueue();
    workQueue = createMockQueue();
    deliverQueue = createMockQueue();
    flowProducer = createMockFlowProducer();

    const module = await Test.createTestingModule({
      providers: [
        TasksScheduler,
        { provide: getQueueToken(QUEUE_NAMES.SIMPLE), useValue: simpleQueue },
        { provide: getQueueToken(QUEUE_NAMES.WORK), useValue: workQueue },
        {
          provide: getQueueToken(QUEUE_NAMES.DELIVER),
          useValue: deliverQueue,
        },
        {
          provide: getFlowProducerToken('task-flow'),
          useValue: flowProducer,
        },
      ],
    }).compile();

    scheduler = module.get(TasksScheduler);
  });

  // ── Pattern A: Simple Job ──────────────────────────────────────

  describe('scheduleSimpleJob', () => {
    it('should schedule a one-shot delayed job', async () => {
      const result = await scheduler.scheduleSimpleJob({
        taskId: 'task_abc123',
        data: simpleData,
        delay: 60_000,
      });

      expect(simpleQueue.add).toHaveBeenCalledWith(
        QUEUE_NAMES.SIMPLE,
        simpleData,
        expect.objectContaining({
          delay: 60_000,
          jobId: 'task_abc123-simple',
        }),
      );
      expect(result.jobId).toBeDefined();
      expect(result.repeatKey).toBeNull();
    });

    it('should schedule a repeatable job', async () => {
      simpleQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'task_abc123-simple', key: 'repeat-key-123' },
      ]);

      const result = await scheduler.scheduleSimpleJob({
        taskId: 'task_abc123',
        data: simpleData,
        repeat: { pattern: '0 8 * * *', tz: 'Africa/Cairo' },
      });

      expect(simpleQueue.add).toHaveBeenCalledWith(
        QUEUE_NAMES.SIMPLE,
        simpleData,
        expect.objectContaining({
          repeat: { pattern: '0 8 * * *', tz: 'Africa/Cairo' },
          jobId: 'task_abc123-simple',
        }),
      );
      expect(result.repeatKey).toBe('repeat-key-123');
    });
  });

  // ── Pattern B: One-Shot Flow Job ───────────────────────────────

  describe('scheduleFlowJob', () => {
    it('should schedule a flow with work child and deliver parent', async () => {
      const result = await scheduler.scheduleFlowJob({
        taskId: 'task_abc123',
        workData,
        deliverData,
        workDelay: 1_800_000, // 30 min
        deliverDelay: 3_600_000, // 60 min
      });

      expect(flowProducer.add).toHaveBeenCalledWith({
        name: QUEUE_NAMES.DELIVER,
        queueName: QUEUE_NAMES.DELIVER,
        data: deliverData,
        opts: { delay: 3_600_000, jobId: 'task_abc123-deliver' },
        children: [
          {
            name: QUEUE_NAMES.WORK,
            queueName: QUEUE_NAMES.WORK,
            data: workData,
            opts: { delay: 1_800_000, jobId: 'task_abc123-work' },
          },
        ],
      });
      expect(result.deliverJobId).toBe('task_abc123-deliver');
      expect(result.workJobId).toBe('task_abc123-work');
    });
  });

  // ── Pattern B: Recurring Flow ──────────────────────────────────

  describe('scheduleRecurringFlow', () => {
    it('should schedule a repeatable deliver job', async () => {
      deliverQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'task_abc123-deliver', key: 'deliver-repeat-key' },
      ]);

      const result = await scheduler.scheduleRecurringFlow({
        taskId: 'task_abc123',
        deliverData,
        repeat: { pattern: '0 9 * * 1', tz: 'Africa/Cairo' },
      });

      expect(deliverQueue.add).toHaveBeenCalledWith(
        QUEUE_NAMES.DELIVER,
        deliverData,
        {
          repeat: { pattern: '0 9 * * 1', tz: 'Africa/Cairo' },
          jobId: 'task_abc123-deliver',
        },
      );
      expect(result.deliverJobId).toBe('task_abc123-deliver');
      expect(result.repeatKey).toBe('deliver-repeat-key');
      expect(result.workJobId).toBeNull();
    });

    it('should schedule first work job when provided', async () => {
      deliverQueue.getRepeatableJobs.mockResolvedValue([]);
      workQueue.add.mockResolvedValue({ id: 'task_abc123-work-abc123def456' });

      const result = await scheduler.scheduleRecurringFlow({
        taskId: 'task_abc123',
        deliverData,
        repeat: { pattern: '0 9 * * 1', tz: 'Africa/Cairo' },
        firstWork: {
          data: workData,
          delay: 1_800_000,
        },
      });

      expect(workQueue.add).toHaveBeenCalled();
      expect(result.workJobId).toBeDefined();
    });
  });

  // ── scheduleNextWorkJob ────────────────────────────────────────

  describe('scheduleNextWorkJob', () => {
    it('should schedule a one-shot work job with unique suffix', async () => {
      const result = await scheduler.scheduleNextWorkJob({
        taskId: 'task_abc123',
        data: workData,
        delay: 1_800_000,
      });

      expect(workQueue.add).toHaveBeenCalledWith(QUEUE_NAMES.WORK, workData, {
        delay: 1_800_000,
        jobId: expect.stringMatching(/^task_abc123-work-[a-f0-9]{12}$/),
      });
      expect(result.jobId).toMatch(/^task_abc123-work-[a-f0-9]{12}$/);
    });
  });

  // ── Cancellation ───────────────────────────────────────────────

  describe('cancelJob', () => {
    it('should remove a pending job', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('delayed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      simpleQueue.getJob.mockResolvedValue(mockJob);

      const result = await scheduler.cancelJob(
        QUEUE_NAMES.SIMPLE,
        'task_abc123-simple',
      );

      expect(result).toBe(true);
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should return false for non-existent job', async () => {
      simpleQueue.getJob.mockResolvedValue(null);

      const result = await scheduler.cancelJob(
        QUEUE_NAMES.SIMPLE,
        'task_missing-simple',
      );

      expect(result).toBe(false);
    });

    it('should skip already completed jobs', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('completed'),
        remove: vi.fn(),
      };
      simpleQueue.getJob.mockResolvedValue(mockJob);

      const result = await scheduler.cancelJob(
        QUEUE_NAMES.SIMPLE,
        'task_abc123-simple',
      );

      expect(result).toBe(false);
      expect(mockJob.remove).not.toHaveBeenCalled();
    });
  });

  describe('cancelRepeatable', () => {
    it('should remove a repeatable by key', async () => {
      simpleQueue.removeRepeatableByKey.mockResolvedValue(true);

      const result = await scheduler.cancelRepeatable(
        QUEUE_NAMES.SIMPLE,
        'repeat-key-123',
      );

      expect(result).toBe(true);
      expect(simpleQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        'repeat-key-123',
      );
    });

    it('should return false when key not found', async () => {
      simpleQueue.removeRepeatableByKey.mockResolvedValue(false);

      const result = await scheduler.cancelRepeatable(
        QUEUE_NAMES.SIMPLE,
        'nonexistent-key',
      );

      expect(result).toBe(false);
    });
  });

  describe('cancelAllJobsForTask', () => {
    it('should attempt to cancel all job variants for a task', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('delayed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      simpleQueue.getJob.mockResolvedValue(mockJob);
      deliverQueue.getJob.mockResolvedValue(mockJob);
      workQueue.getJob.mockResolvedValue(mockJob);

      await scheduler.cancelAllJobsForTask('task_abc123', 'repeat-key-123');

      expect(simpleQueue.getJob).toHaveBeenCalledWith('task_abc123-simple');
      expect(deliverQueue.getJob).toHaveBeenCalledWith('task_abc123-deliver');
      expect(workQueue.getJob).toHaveBeenCalledWith('task_abc123-work');
    });
  });

  // ── Queue Access ───────────────────────────────────────────────

  describe('getQueue', () => {
    it('should return the correct queue by name', () => {
      expect(scheduler.getQueue(QUEUE_NAMES.SIMPLE)).toBe(simpleQueue);
      expect(scheduler.getQueue(QUEUE_NAMES.WORK)).toBe(workQueue);
      expect(scheduler.getQueue(QUEUE_NAMES.DELIVER)).toBe(deliverQueue);
    });

    it('should throw for unknown queue name', () => {
      expect(() => scheduler.getQueue('unknown')).toThrow('Unknown queue');
    });
  });
});
