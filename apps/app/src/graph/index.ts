import {
  MatrixCheckpointSaver,
  type IRunnableConfigWithRequiredFields,
} from '@ixo/matrix';
import { START, StateGraph } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { HumanMessage } from 'langchain';
import CallbackHandler from 'langfuse-langchain';
import { type BrowserToolCallDto } from 'src/messages/dto/send-message.dto';
import { chatNode } from './nodes/chat-node/chat-node';
import {
  CustomerSupportGraphState,
  type TCustomerSupportGraphState,
} from './state';
import { GraphNodes } from './types';

const langfuseHandler = new CallbackHandler({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
  flushInterval: 2,
});

const oracleName = process.env.ORACLE_NAME;
if (!oracleName) {
  throw new Error('ORACLE_NAME is not set');
}
const workflow = new StateGraph(CustomerSupportGraphState)

  // Nodes
  .addNode(GraphNodes.Chat, chatNode)

  // Routes
  .addEdge(START, GraphNodes.Chat);

const mxGraph = workflow.compile({
  checkpointer: new MatrixCheckpointSaver(),
});

export class CustomerSupportGraph {
  constructor(private readonly matrixCompiledGraph = mxGraph) {}

  async sendMessage(
    input: string,
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    },
    browserTools?: BrowserToolCallDto[],
    msgFromMatrixRoom = false,
    initialUserContext?: TCustomerSupportGraphState['userContext'],
    editorRoomId?: string,
    currentEntityDid?: string,
    clientType?: 'matrix' | 'slack',
  ): Promise<TCustomerSupportGraphState> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    Logger.log(
      `[sendMessage]: msgFromMatrixRoom: ${msgFromMatrixRoom} input: ${input}`,
    );

    return this.matrixCompiledGraph.invoke(
      {
        messages: [
          new HumanMessage({
            content: input,
            // this is to prevent the matrix manager to log this message as this message is from the matrix room itself not from the REST api
            additional_kwargs: {
              msgFromMatrixRoom,
              timestamp: new Date().toISOString(),
            },
          }),
        ],
        browserTools,
        editorRoomId,
        currentEntityDid,
        client: clientType ?? 'portal',
        ...(initialUserContext ? { userContext: initialUserContext } : {}),
      } satisfies Partial<TCustomerSupportGraphState>,

      {
        ...runnableConfig,
        recursionLimit: 50,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: runnableConfig.configurable.sessionId,
        },
        callbacks: [langfuseHandler],
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
      },
    );
  }

  async streamMessage(
    input: string,
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    },
    browserTools?: BrowserToolCallDto[],
    msgFromMatrixRoom = false,
    initialUserContext?: TCustomerSupportGraphState['userContext'],
    abortController?: AbortController,
    editorRoomId?: string,
    currentEntityDid?: string,
  ) {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }

    // Debug: Log abort signal state
    if (abortController) {
      Logger.debug(
        `[streamMessage] AbortController passed, signal.aborted: ${abortController.signal.aborted}`,
      );
      abortController.signal.addEventListener('abort', () => {
        Logger.debug('[streamMessage] Abort signal fired!');
      });
    }

    const stream = this.matrixCompiledGraph.streamEvents(
      {
        messages: [
          new HumanMessage({
            content: input,
            // this is to prevent the matrix manager to log this message as this message is from the matrix room itself not from the REST api
            additional_kwargs: {
              msgFromMatrixRoom,
              timestamp: new Date().toISOString(),
            },
          }),
        ],
        browserTools,
        ...(initialUserContext ? { userContext: initialUserContext } : {}),
        editorRoomId,
        currentEntityDid,
      } satisfies Partial<TCustomerSupportGraphState>,

      {
        version: 'v2',
        ...runnableConfig,
        streamMode: 'messages',
        recursionLimit: 50,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: runnableConfig.configurable.sessionId,
        },
        callbacks: [langfuseHandler],
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
        // Signal must be last to ensure it's not overwritten by runnableConfig spread
        signal: abortController?.signal,
      },
    );

    return stream;
  }

  public async getGraphState(
    config: IRunnableConfigWithRequiredFields & { sessionId: string },
  ): Promise<TCustomerSupportGraphState | undefined> {
    const state = await this.matrixCompiledGraph.getState(config);
    if (Object.keys(state.values as TCustomerSupportGraphState).length === 0) {
      return undefined;
    }
    return state.values as TCustomerSupportGraphState;
  }
}

export const customerSupportGraph = new CustomerSupportGraph();
