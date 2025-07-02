export const EVENT_NAME = 'browser_tool_call';

export interface IBrowserToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: any;
}
