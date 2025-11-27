/**
 * Action call event interface for AG-UI actions
 *
 * @remarks
 * Args transmission strategy:
 * - WebSocket events: Include full args (sent to frontend for handler execution and render)
 * - SSE events: Exclude args (status-only updates for chat UI timeline)
 *
 * This design eliminates data duplication by sending args only once via WebSocket.
 */
export interface IActionCallEvent {
  toolCallId: string;
  toolName: string;
  /** Args are sent via WebSocket only, not in SSE status updates */
  args?: unknown;
  status?: 'isRunning' | 'done' | 'error';
  output?: string;
  result?: unknown;
  error?: string;
}

export const EVENT_NAME = 'action_call' as const;
