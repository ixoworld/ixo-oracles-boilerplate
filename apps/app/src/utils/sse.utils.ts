import { type AllEvents } from '@ixo/oracles-events';
import { type Response } from 'express';

/**
 * Format an event as a Server-Sent Event (SSE) message
 * SSE format: "event: <eventName>\ndata: <jsonPayload>\n\n"
 *
 * @param event - The event object to format (from @ixo/oracles-events)
 * @returns Formatted SSE string
 */
export function formatSSEEvent(event: AllEvents): string {
  return `event: ${event.eventName}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

/**
 * Format a simple message as an SSE event
 * Useful for sending raw data without using the event system
 *
 * @param eventType - The event type/name
 * @param data - The data payload
 * @returns Formatted SSE string
 */
export function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Send an SSE heartbeat (comment) to keep the connection alive
 * Prevents proxies and load balancers from timing out the connection
 *
 * @param res - Express Response object
 */
export function sendSSEHeartbeat(res: Response): void {
  if (!res.writableEnded) {
    res.write(': heartbeat\n\n');
  }
}

/**
 * Start a heartbeat interval to keep SSE connection alive
 * Heartbeats are sent every 15 seconds
 *
 * @param res - Express Response object
 * @returns NodeJS.Timer that should be cleared when streaming ends
 */
export function startSSEHeartbeat(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    sendSSEHeartbeat(res);
  }, 15000); // 15 seconds
}

/**
 * Send SSE headers for proper streaming
 *
 * @param res - Express Response object
 * @param requestId - Optional request ID to include in headers
 */
export function setSSEHeaders(res: Response, requestId?: string): void {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  };

  if (requestId) {
    headers['X-Request-Id'] = requestId;
    headers['Access-Control-Expose-Headers'] = 'X-Request-Id';
  }

  res.set(headers);
}

/**
 * Send a 'done' event to signal completion of streaming
 *
 * @param res - Express Response object
 */
export function sendSSEDone(res: Response): void {
  if (!res.writableEnded) {
    res.write(formatSSE('done', {}));
  }
}

/**
 * Send an error event via SSE
 *
 * @param res - Express Response object
 * @param error - Error object or message
 */
export function sendSSEError(res: Response, error: Error | string): void {
  if (!res.writableEnded) {
    const errorData = {
      error: error instanceof Error ? error.message : error,
      timestamp: new Date().toISOString(),
    };
    res.write(formatSSE('error', errorData));
  }
}
