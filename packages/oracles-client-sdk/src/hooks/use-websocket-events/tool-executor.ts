import type { Socket } from 'socket.io-client';

export interface ToolExecutionConfig {
  socket: Socket;
  toolId: string;
  eventName: 'tool_result' | 'action_call_result';
  sessionId?: string;
}

/**
 * Execute a tool/action and emit the result via WebSocket
 * This unified function handles both browser tools and AG-UI actions
 * @param config Configuration for tool execution and result emission
 * @param executor Function that executes the tool/action
 */
export async function executeToolAndEmitResult<T>(
  config: ToolExecutionConfig,
  executor: () => Promise<T>,
): Promise<void> {
  try {
    const result = await executor();

    // Emit success result
    config.socket.emit(config.eventName, {
      toolCallId: config.toolId,
      sessionId: config.sessionId,
      result,
    });
  } catch (error) {
    // Emit error result
    config.socket.emit(config.eventName, {
      toolCallId: config.toolId,
      sessionId: config.sessionId,
      result:
        config.eventName === 'action_call_result'
          ? {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          : null,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
