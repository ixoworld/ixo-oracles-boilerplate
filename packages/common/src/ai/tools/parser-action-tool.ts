import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { tool } from '@langchain/core/tools';
import { callAgAction } from './action-caller.js';
import { logActionToMatrix } from './log-action-to-matrix.js';

interface IParseAgActionParams {
  name: string;
  description: string;
  schema: Record<string, any>;
}

// Helper function to parse AG-UI action into LangChain tool
export function parserActionTool(action: IParseAgActionParams) {
  const { name, description, schema } = action;
  return tool(
    async (input, runnableConfig) => {
      const { configurable } =
        runnableConfig as IRunnableConfigWithRequiredFields;
      const { thread_id: sessionId, requestId, configs } = configurable;

      if (!sessionId) {
        throw new Error('sessionId is required for AG-UI actions');
      }

      // Call the action and WAIT for result from frontend
      const result = await callAgAction({
        sessionId,
        toolCallId: `ag_${requestId}`,
        toolName: name,
        args: input,
        timeout: 5000, // 5 seconds
      });

      if (configs?.matrix.roomId) {
        logActionToMatrix(
          {
            name: name,
            args: input as Record<string, unknown>,
            result,
            success: true,
          },
          {
            roomId: configs.matrix.roomId,
            threadId: sessionId,
          },
        );
      }

      // Return the actual result from frontend
      return JSON.stringify(result);
    },
    {
      name: name,
      description: description,
      schema: schema,
      metadata: {
        actionTool: true,
      },
    },
  );
}
