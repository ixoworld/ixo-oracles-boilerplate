import { DEFAULT_TOOL_CALL_COMPONENT_NAME } from '../hooks/use-chat/transform-to-messages-map.js';

export const getToolName = (toolName?: string, ...args: (string | undefined)[]) => {
  // Find the first tool name that is not the default
  if (toolName && toolName.toLowerCase() !== DEFAULT_TOOL_CALL_COMPONENT_NAME.toLowerCase()) {
    return toolName;
  }
  const found = args.find(
    (name) => name && name.toLowerCase() !== DEFAULT_TOOL_CALL_COMPONENT_NAME.toLowerCase()
  );
  return found ?? DEFAULT_TOOL_CALL_COMPONENT_NAME;
};
