import {
  BaseEvent,
  shouldHaveConnectionId,
  type WithRequiredEventProps,
} from '../base-event/base-event';

interface IToolCallEvent {
  toolName: string;
  args?: unknown;
  status?: 'isRunning' | 'done';
  eventId?: string;
}

export class ToolCallEvent extends BaseEvent<IToolCallEvent> {
  constructor(public payload: WithRequiredEventProps<IToolCallEvent>) {
    payload.status = payload.status ?? 'isRunning';
    super();
    shouldHaveConnectionId(payload);
  }
  public eventName = 'tool_call';

  static eventName = 'tool_call' as const;
}
