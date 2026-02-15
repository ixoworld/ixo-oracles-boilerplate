import { rootEventEmitter } from '@ixo/oracles-events';
import { BrowserToolCallEvent } from '@ixo/oracles-events';
import { ActionCallEvent } from '@ixo/oracles-events';

export interface IFrontendToolCallerParams {
  sessionId: string;
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  toolType: 'browser' | 'agui';
  timeout?: number;
}

/**
 * Unified function to call frontend tools (browser tools or AG-UI actions)
 * and wait for their result via WebSocket
 * @param params - The parameters for the frontend tool call
 * @returns Promise that resolves with the tool result
 */
export async function callFrontendTool({
  sessionId,
  toolId,
  toolName,
  args,
  toolType,
  timeout = 15000,
}: IFrontendToolCallerParams): Promise<unknown> {
  // Step 1: Emit appropriate event based on tool type
  if (toolType === 'browser') {
    new BrowserToolCallEvent({
      sessionId,
      requestId: toolId,
      toolCallId: toolId,
      toolName,
      args,
    }).emit();
  } else {
    new ActionCallEvent({
      sessionId,
      requestId: toolId,
      toolCallId: toolId,
      toolName,
      args,
      status: 'isRunning',
    }).emit();
  }

  // Step 2: Wait for result via rootEventEmitter
  const resultEventName =
    toolType === 'browser' ? 'browser_tool_result' : 'action_call_result';

  return await new Promise((resolve, reject) => {
    // eslint-disable-next-line prefer-const -- assigned after handler definition due to mutual reference
    let timeoutHandle: NodeJS.Timeout;
    const resultHandler = (...args: unknown[]) => {
      const data = args[0] as {
        toolCallId: string;
        error?: string;
        result?: Record<string, unknown>;
      };
      const receivedId = data.toolCallId;
      if (receivedId === toolId) {
        clearTimeout(timeoutHandle);
        rootEventEmitter.removeListener(resultEventName, resultHandler);

        // Handle success
        if (data.error) {
          reject(new Error(data.error));
        } else if (toolType === 'agui' && data.result?.success === false) {
          // AG-UI specific error handling
          reject(new Error((data.result.error as string) || 'Action failed'));
        } else {
          resolve(data.result);
        }
      }
    };

    // Listen for the specific tool result
    rootEventEmitter.on(resultEventName, resultHandler);

    // Set timeout
    timeoutHandle = setTimeout(() => {
      rootEventEmitter.removeListener(resultEventName, resultHandler);
      reject(
        new Error(
          `${toolType === 'agui' ? 'AG-UI action' : 'Browser tool'} timeout after ${timeout}ms: ${toolName}`,
        ),
      );
    }, timeout);
  });
}
