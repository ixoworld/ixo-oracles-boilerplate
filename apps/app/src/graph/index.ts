import {
  MatrixCheckpointSaver,
  type IRunnableConfigWithRequiredFields,
} from '@ixo/matrix';
import { type StreamEvent } from '@langchain/core/dist/tracers/event_stream';
import { HumanMessage } from '@langchain/core/messages';
import { type IterableReadableStream } from '@langchain/core/utils/stream';
import { END, START, StateGraph } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import CallbackHandler from 'langfuse-langchain';
import { type BrowserToolCallDto } from 'src/messages/dto/send-message.dto';
import { chatNode } from './nodes/chat-node/chat-node';
import { toolNode } from './nodes/tools-node';
import toolsChatRouter from './router/tools.router';
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
  .addNode(GraphNodes.Tools, toolNode)

  // Routes
  .addEdge(START, GraphNodes.Chat)

  .addConditionalEdges(GraphNodes.Chat, toolsChatRouter, {
    [GraphNodes.Tools]: GraphNodes.Tools,
    [END]: END,
  })
  .addEdge(GraphNodes.Tools, GraphNodes.Chat);

const compiledGraph = workflow.compile({
  checkpointer: new MatrixCheckpointSaver(),
});

export class CustomerSupportGraph {
  constructor(private readonly graph = compiledGraph) {}

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
  ): Promise<TCustomerSupportGraphState> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    Logger.log(`[sendMessage]: msgFromMatrixRoom: ${msgFromMatrixRoom}`);
    return this.graph.invoke(
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
      } satisfies Partial<TCustomerSupportGraphState>,

      {
        ...runnableConfig,
        recursionLimit: 15,
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
    abortSignal?: AbortSignal,
  ): Promise<IterableReadableStream<StreamEvent>> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    const stream = this.graph.streamEvents(
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
      } satisfies Partial<TCustomerSupportGraphState>,

      {
        version: 'v2',
        ...runnableConfig,
        streamMode: 'messages',
        recursionLimit: 15,
        signal: abortSignal,
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

    return stream;
  }

  public async getGraphState(
    config: IRunnableConfigWithRequiredFields & { sessionId: string },
  ): Promise<TCustomerSupportGraphState | undefined> {
    const state = await this.graph.getState(config);
    if (Object.keys(state.values as TCustomerSupportGraphState).length === 0) {
      return undefined;
    }
    return state.values as TCustomerSupportGraphState;
  }
}

export const customerSupportGraph = new CustomerSupportGraph();
