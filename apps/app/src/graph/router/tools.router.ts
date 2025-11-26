import { END } from '@langchain/langgraph';
import { type TMainAgentGraphState } from '../state';
import { GraphNodes } from '../types';

const toolsChatRouter = (state: TMainAgentGraphState): string => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (
    'tool_calls' in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length
  ) {
    return GraphNodes.Tools;
  }
  return END;
};

export default toolsChatRouter;
