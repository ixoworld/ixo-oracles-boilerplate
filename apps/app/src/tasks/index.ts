// Task metadata schema (Y.Map sidecar)
export type {
  TaskMeta,
  TaskType,
  JobPattern,
  TaskStatus,
  ComplexityTier,
  ModelTier,
  ChannelType,
  NotificationPolicy,
  OutputRow,
} from './task-meta';
export {
  DEFAULT_MODEL_TIER,
  DEFAULT_JOB_PATTERN,
  DEFAULT_NOTIFICATION_POLICY,
  DEFAULT_COMPLEXITY,
  BUFFER_MINUTES,
} from './task-meta';

// Task page Markdown template
export type { TaskPageParams, TaskPageInput } from './task-page-template';
export {
  generateTaskPage,
  buildTaskPageParams,
  formatOutputTable,
} from './task-page-template';

// Y.Doc structure and helpers
export type { CreateTaskMetaParams } from './task-doc';
export {
  YDOC_TASK_META_KEY,
  getTaskMetaMap,
  readTaskMeta,
  updateTaskMeta,
  buildTaskMeta,
  writeTaskMetaToDoc,
  createStandaloneTaskDoc,
  appendOutputRow,
  generateTaskId,
} from './task-doc';

// Scheduler (queues, types, service)
export type {
  SimpleJobData,
  WorkJobData,
  DeliverJobData,
  QueueName,
  ScheduleSimpleJobParams,
  ScheduleFlowJobParams,
  ScheduleRecurringFlowParams,
  ScheduleNextWorkJobParams,
} from './scheduler';
export {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  WORKER_OPTIONS,
  TasksScheduler,
} from './scheduler';

// TasksModule
export { TasksModule } from './tasks.module';
