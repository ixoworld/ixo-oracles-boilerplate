import { callFrontendTool } from './frontend-tool-caller.js';

export interface AgActionResult {
  result?: any;
  error?: string;
  success: boolean;
}

export interface IAgActionCallerParams {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: any;
  timeout?: number;
}

/**
 * Call an AG-UI action that executes on the frontend and wait for the result
 * @param params - The parameters for the AG-UI action call
 * @returns Promise that resolves with the action result
 */
export async function callAgAction({
  sessionId,
  toolCallId,
  toolName,
  args,
  timeout = 10000, // 10 seconds for UI actions
}: IAgActionCallerParams): Promise<any> {
  return callFrontendTool({
    sessionId,
    toolId: toolCallId,
    toolName,
    args,
    toolType: 'agui',
    timeout,
  });
}
