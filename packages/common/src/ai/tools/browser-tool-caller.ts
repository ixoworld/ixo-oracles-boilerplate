import { BrowserToolCallEvent, rootEventEmitter } from '@ixo/oracles-events';

export interface BrowserToolResult {
  result?: any;
  error?: string;
  success: boolean;
}

export interface IBrowserToolCallerParams {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: any;
  timeout?: number;
}

/**
 * Call a tool that executes on the browser client and wait for the result
 * @param params - The parameters for the browser tool call
 * @returns Promise that resolves with the tool result
 */
export async function callBrowserTool({
  sessionId,
  toolCallId,
  toolName,
  args,
  timeout = 15000,
}: IBrowserToolCallerParams): Promise<any> {
  // Step 1: Emit browser tool call event (automatically goes to client via BaseEvent)
  new BrowserToolCallEvent({
    sessionId,
    requestId: toolCallId,
    toolCallId,
    toolName,
    args,
  }).emit();

  // Step 2: Wait for result via rootEventEmitter
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout;

    const resultHandler = (data: any) => {
      if (data.toolCallId === toolCallId) {
        clearTimeout(timeoutHandle);
        rootEventEmitter.removeListener('browser_tool_result', resultHandler);

        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.result);
        }
      }
    };

    // Listen for the specific tool result
    rootEventEmitter.on('browser_tool_result', resultHandler);

    // Set timeout
    timeoutHandle = setTimeout(() => {
      rootEventEmitter.removeListener('browser_tool_result', resultHandler);
      reject(
        new Error(`Browser tool call timeout after ${timeout}ms: ${toolName}`),
      );
    }, timeout);
  });
}
