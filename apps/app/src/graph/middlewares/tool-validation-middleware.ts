import { Logger } from '@nestjs/common';
import { createMiddleware, ToolMessage } from 'langchain';

/**
 * Middleware that catches tool validation errors and handles them gracefully.
 * This prevents the FilesystemMiddleware from throwing unhandled errors when
 * tool inputs don't match their expected schemas.
 */
export const createToolValidationMiddleware = () => {
  return createMiddleware({
    name: 'ToolValidationMiddleware',
    wrapToolCall: async (toolCallRequest, handler) => {
      const toolCall = toolCallRequest.toolCall;
      try {
        // Attempt to call the tool
        return await handler(toolCallRequest);
      } catch (error: any) {
        // Check if this is a schema validation error
        const errorMessage = error?.message || '';
        const isSchemaError =
          errorMessage.includes('did not match expected schema') ||
          errorMessage.includes('Received tool input did not match') ||
          errorMessage.includes('schema') ||
          error?.name === 'ZodError';

        if (isSchemaError) {
          const toolName = toolCall.name ?? toolCallRequest.tool.name ?? '';
          Logger.warn(
            `Tool validation error for ${toolName}: ${errorMessage}`,
            {
              toolName,
              toolArgs: toolCall.args,
              error: errorMessage,
            },
          );

          // Return a helpful error message instead of crashing
          return new ToolMessage({
            content: `Error: The tool "${toolName}" was called with invalid parameters. ${errorMessage}. Please check the tool's required parameters and try again with the correct format.`,
            tool_call_id: toolCall.id ?? '',
            name: toolName ?? '',
          });
        }

        // Re-throw non-schema errors
        throw error;
      }
    },
    beforeModel(state, runtime) {

      const toolMessage = state.messages.find((message) => message.type === 'tool');

      const agentsTools = [
        'list_blocks',
        'read_block_by_id',
        'edit_block',
        'create_block',
        'read_survey',
        'fill_survey_answers',
        'validate_survey_answers',
        "firecrawl",
      ];

      if (toolMessage && toolMessage.name && agentsTools.includes(toolMessage.name)) {
        Logger.log(`Tool validation middleware: ${toolMessage.name} is an agent tool, skipping`);
        return {
          ...state,
          messages: state.messages.filter((message) => message.type !== 'tool'),
        };
      }
      return state;
    },
  });
};
