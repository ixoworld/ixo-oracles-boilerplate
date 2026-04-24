import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { tool } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import { callAgAction } from './action-caller.js';
import { logActionToMatrix } from './log-action-to-matrix.js';

interface IParseAgActionParams {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

// Helper function to parse AG-UI action into LangChain tool
export function parserActionTool(action: IParseAgActionParams) {
  const { name, description, schema } = action;
  return tool(
    async (input, runnableConfig) => {
      const { configurable } =
        runnableConfig as IRunnableConfigWithRequiredFields;
      // Prefer explicit `sessionId` — sub-agent wrappers set this to the real
      // user WS session so routing works from nested contexts. Fall back to
      // `thread_id` for direct invocations from the main agent (where
      // thread_id IS the user's session).
      const sessionIdField = (
        configurable as { sessionId?: unknown }
      ).sessionId;
      const sessionId =
        typeof sessionIdField === 'string' && sessionIdField.length > 0
          ? sessionIdField
          : configurable.thread_id;
      const { requestId, configs } = configurable;

      if (!sessionId) {
        throw new Error('sessionId is required for AG-UI actions');
      }

      // Unique toolCallId per invocation. Protects against:
      //  - Multiple tool calls sharing one requestId (React key collisions)
      //  - Any future code path that forgets to propagate requestId
      const toolCallId = `ag_${requestId ?? 'noreq'}_${randomUUID().slice(0, 8)}`;

      // Call the action and WAIT for result from frontend
      const result = await callAgAction({
        sessionId,
        toolCallId,
        toolName: name,
        args: input as Record<string, unknown>,
        timeout: 15000, // 15 seconds
      });

      if (configs?.matrix.roomId) {
        void logActionToMatrix(
          {
            name,
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
      name,
      description,
      schema,
      metadata: {
        actionTool: true,
      },
    },
  );
}
