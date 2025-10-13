import { parserBrowserTool } from '@ixo/common';
import {
  type IRunnableConfigWithRequiredFields,
  MatrixManager,
} from '@ixo/matrix';
import { type ToolMessage } from '@langchain/core/messages';
import { type RunnableConfig } from '@langchain/core/runnables';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { getMemoryEngineMcpTools, tools } from './tools';

const mx = MatrixManager.getInstance();

async function toolNode(
  state: TCustomerSupportGraphState,
  config?: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> {
  const {
    configurable: { configs, thread_id },
  } = config as IRunnableConfigWithRequiredFields;
  const browserTools = state.browserTools?.map((tool) =>
    parserBrowserTool({
      description: tool.description,
      schema: tool.schema,
      toolName: tool.name,
    }),
  );

  const mcpTools = await getMemoryEngineMcpTools({
    userMatrixOpenIdToken: configs?.user?.matrixOpenIdToken ?? '',
    oracleDid: configs?.matrix.oracleDid ?? '',
    roomId: configs?.matrix.roomId ?? '',
  });

  const tn = new ToolNode([...tools, ...(browserTools ?? []), ...mcpTools]);

  const toolMsg: ToolMessage = await tn.invoke(state.messages);

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
