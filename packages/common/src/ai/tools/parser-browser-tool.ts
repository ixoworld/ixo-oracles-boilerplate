import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { tool } from '@langchain/core/tools';
import { callBrowserTool } from './browser-tool-caller.js';
import { logActionToMatrix } from './log-action-to-matrix.js';

interface IParserBrowserToolParams {
  description: string;
  schema: Record<string, any>;
  toolName: string;
}

export function parserBrowserTool(params: IParserBrowserToolParams) {
  const { description, schema, toolName } = params;
  return tool(
    async (input, runnablesConfig) => {
      const {
        configurable: { thread_id: sessionId, requestId, configs },
      } = runnablesConfig as IRunnableConfigWithRequiredFields;
      if (!sessionId) {
        throw new Error('sessionId is required');
      }

      const result = await callBrowserTool({
        sessionId,
        toolName,
        args: input,
        toolCallId: `tc-${requestId}`,
      });

      if (configs?.matrix.roomId) {
        logActionToMatrix(
          {
            name: toolName,
            args: input as Record<string, any>,
            result,
            success: true,
          },
          {
            roomId: configs.matrix.roomId,
            threadId: sessionId,
          },
        );
      }
      return result;
    },
    {
      name: toolName,
      description,
      schema,
      metadata: {
        browserTool: true,
      },
    },
  );
}
