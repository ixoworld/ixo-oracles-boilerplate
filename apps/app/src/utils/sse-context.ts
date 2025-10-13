import { type AllEvents } from '@ixo/oracles-events';
import { AsyncLocalStorage } from 'async_hooks';
import { type Response } from 'express';
import { formatSSEEvent } from './sse.utils';

interface SSEContext {
  res: Response;
  abortSignal?: AbortSignal;
}

/**
 * AsyncLocalStorage instance for SSE context
 * This allows any part of the async call chain to access the Response object
 * and abort signal without explicitly passing them through function parameters
 */
const sseContextStorage = new AsyncLocalStorage<SSEContext>();

/**
 * Run a callback within an SSE context
 * The Response object and abort signal will be available to all async operations within the callback
 *
 * @param res - Express Response object for SSE streaming
 * @param callback - Async function to run within the SSE context
 * @param abortSignal - Optional abort signal for request cancellation
 * @returns The result of the callback
 *
 * @example
 * await runWithSSEContext(res, async () => {
 *   await processStream();
 *   // Inside processStream or any nested function, you can call emitSSEEvent()
 * }, abortSignal);
 */
export function runWithSSEContext<T>(
  res: Response,
  callback: () => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  return sseContextStorage.run({ res, abortSignal }, callback);
}

/**
 * Emit an SSE event from anywhere in the async call chain
 * This function can be called from graph nodes or any other code
 * running within an SSE context
 *
 * @param event - The event to emit (from @ixo/oracles-events)
 *
 * @example
 * // In any graph node or nested function
 * emitSSEEvent(new ToolCallEvent({
 *   sessionId,
 *   requestId,
 *   toolName: 'search',
 *   args: {},
 *   status: 'isRunning',
 * }));
 */
export function emitSSEEvent(event: AllEvents): void {
  const context = sseContextStorage.getStore();
  if (context?.res && !context.res.writableEnded) {
    context.res.write(formatSSEEvent(event));
  }
}

/**
 * Get the current SSE Response object from the context
 * Returns undefined if not running within an SSE context
 *
 * @returns The Response object or undefined
 */
export function getSSEContext(): Response | undefined {
  return sseContextStorage.getStore()?.res;
}

/**
 * Get the current abort signal from the context
 * Returns undefined if not running within an SSE context or no abort signal set
 *
 * @returns The AbortSignal or undefined
 */
export function getSSEAbortSignal(): AbortSignal | undefined {
  return sseContextStorage.getStore()?.abortSignal;
}

/**
 * Check if currently running within an SSE context
 *
 * @returns true if within an SSE context, false otherwise
 */
export function hasSSEContext(): boolean {
  return sseContextStorage.getStore() !== undefined;
}

/**
 * Check if the current request has been aborted
 *
 * @returns true if aborted, false otherwise
 */
export function isSSEAborted(): boolean {
  const context = sseContextStorage.getStore();
  return context?.abortSignal?.aborted ?? false;
}
