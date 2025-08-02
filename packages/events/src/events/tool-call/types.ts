export interface IToolCallEvent {
  toolName: string;
  args?: unknown;
  status?: 'isRunning' | 'done';
  eventId?: string;
  output?: string;
}

export const EVENT_NAME = 'tool_call' as const;
