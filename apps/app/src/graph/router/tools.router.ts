import { END } from '@langchain/langgraph';
import { type TCustomerSupportGraphState } from '../state';
import { GraphNodes } from '../types';

const toolsChatRouter = (state: TCustomerSupportGraphState): string => {
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
