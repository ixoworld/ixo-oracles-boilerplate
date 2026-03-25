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
  formatOutputSection,
} from './task-page-template';

// Y.Doc structure and helpers
export type { CreateTaskMetaParams } from './task-doc';
export {
  YDOC_TASK_META_KEY,
  getTaskMetaMap,
  readTaskMeta,
  updateTaskMeta,
  buildTaskMeta,
  appendOutputRow,
  generateTaskId,
} from './task-doc';

// TasksService (CRUD layer)
export { TasksService } from './task.service';

// TasksService types and constants
export type {
  CreateTaskParams,
  GetTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  CreateTaskResult,
  ListTasksOptions,
  ListTasksResult,
  TaskIndexEntry,
  TasksIndexHeader,
  TasksIndexChunk,
} from './task-service.types';
export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PAGE_SIZE,
  TASK_STATE_EVENT_TYPE,
  TASKS_INDEX_EVENT_TYPE,
} from './task-service.types';

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

// Task doc helpers
export { sharedServerEditor, withTaskDoc } from './task-doc-helpers';

// Approval service
export { ApprovalService } from './approval.service';

// Processors
export {
  SimpleProcessor,
  WorkProcessor,
  DeliverProcessor,
  ApprovalProcessor,
  TASK_RUN_EVENT_TYPE,
  MAX_CONSECUTIVE_FAILURES,
  APPROVAL_REQUEST_EVENT_TYPE,
  APPROVAL_REMINDER_MS,
  APPROVAL_EXPIRY_MS,
  buildMentionMessage,
  escapeHtml,
  formatOutputDate,
  formatApprovalRequestMessage,
  handleJobFailure,
  isTaskRunnable,
  classifyApprovalResponse,
  resolveMainRoomId,
  sendTaskNotification,
  truncateText,
  SimpleJobDataSchema,
  WorkJobDataSchema,
  DeliverJobDataSchema,
} from './processors';
export type {
  ApprovalClassification,
  ApprovalStatus,
  ApprovalRequestEventContent,
  TaskRunEventContent,
  WorkResult,
} from './processors';

// TasksModule
export { TasksModule } from './tasks.module';
