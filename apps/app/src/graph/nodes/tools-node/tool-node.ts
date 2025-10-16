import { parserBrowserTool } from '@ixo/common';
import {
  MatrixManager,
  type IRunnableConfigWithRequiredFields,
} from '@ixo/matrix';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { ToolNode, type ToolMessage } from 'langchain';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { getMemoryEngineMcpTools, tools } from './tools';

const mx = MatrixManager.getInstance();

async function toolNode(
  state: TCustomerSupportGraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const {
    configurable: { configs, thread_id },
  } = config as IRunnableConfigWithRequiredFields;
  if (!configs?.user?.did) {
    throw new Error('User DID is required');
  }
  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );

  const mcpTools = await getMemoryEngineMcpTools({
    userDid: configs?.user?.did,
    oracleDid: configs?.matrix.oracleDid ?? '',
    roomId: configs?.matrix.roomId ?? '',
  });

  const tn = new ToolNode([...tools, ...(browserTools ?? []), ...mcpTools]);

  const toolMsg: ToolMessage = await tn.invoke(state.messages, config);

  const room = configs?.matrix.roomId ?? '';
  mx.sendActionLog(
    room,
    {
      name: 'toolNode',
      args: {
        toolMsg,
      },
      result: toolMsg,
      success: true,
    },
    thread_id,
  ).catch((err) => {
    Logger.error('Error sending action log', err);
  });

  return {
    messages: Array.isArray(toolMsg) ? toolMsg : [toolMsg],
  };
}

export { toolNode };
