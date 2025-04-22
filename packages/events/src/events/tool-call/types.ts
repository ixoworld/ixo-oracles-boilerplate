export interface IToolCallEvent {
  toolName: string;
  args?: unknown;
  status?: 'isRunning' | 'done';
  eventId?: string;
}

export const EVENT_NAME = 'tool_call' as const;
