import { parserBrowserTool } from '@ixo/common';
import { type ToolMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { tools } from './tools';

async function toolNode(
  state: TCustomerSupportGraphState,
): Promise<Partial<TCustomerSupportGraphState>> {
  console.log('🚀 ~ toolNode ~ state.browserTools:', state.browserTools);
  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );

  const tn = new ToolNode([...tools, ...(browserTools ?? [])]);

  const toolMsg: ToolMessage = await tn.invoke(state.messages);
  console.log('🚀 ~ toolNode ~ toolMsg:', toolMsg);
  return {
    messages: Array.isArray(toolMsg) ? toolMsg : [toolMsg],
  };
}

export { toolNode };
