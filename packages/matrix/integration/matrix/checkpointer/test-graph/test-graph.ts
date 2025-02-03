import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import {
  Annotation,
  END,
  messagesStateReducer,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { MatrixCheckpointSaver } from 'src/checkpointer';

const graphState = Annotation.Root({
  docs: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

const workflow = new StateGraph(graphState)
  .addNode('firstNode', (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return {
      messages: [
        new AIMessage({
          content: `AI-${lastMessage?.content.toString()}`,
        }),
      ],
    };
  })
  .addNode('findDocs', (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return {
      docs: [`doc-${lastMessage?.content.toString()}`],
    };
  })
  .addEdge(START, 'findDocs')
  .addEdge('findDocs', 'firstNode')
  .addEdge('firstNode', END);

export const testGraph = workflow.compile({
  checkpointer: new MatrixCheckpointSaver('guru'),
});
