import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tools } from './tools';

const toolNode = new ToolNode(tools);

export { toolNode };
