import {
  MatrixCheckpointSaver,
  type IRunnableConfigWithRequiredFields,
} from '@ixo/matrix';
import { type StreamEvent } from '@langchain/core/dist/tracers/event_stream';
import { HumanMessage } from '@langchain/core/messages';
import { type IterableReadableStream } from '@langchain/core/utils/stream';
import { END, START, StateGraph } from '@langchain/langgraph';
import 'dotenv/config';
import CallbackHandler from 'langfuse-langchain';
import { chatNode } from './chat-node/chat-node';
import { agentWithChainOfThoughtsNode } from './nodes/agent-with-chain-of-thoughts/agent-with-chain-of-thoughts';
import { evaluationNode } from './nodes/evaluation-node/evaluation-node';
import { toolNode } from './nodes/tools-node';
import { intentRouter } from './router/intent.router';
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
  .addNode(GraphNodes.AgentWithChainOfThoughts, agentWithChainOfThoughtsNode)
  .addNode(GraphNodes.Evaluation, evaluationNode)
  .addNode(GraphNodes.Tools, toolNode)

  // Routes
  .addConditionalEdges(START, intentRouter)

  .addConditionalEdges(GraphNodes.AgentWithChainOfThoughts, toolsChatRouter, {
    [GraphNodes.Tools]: GraphNodes.Tools,
    [GraphNodes.Evaluation]: GraphNodes.Evaluation,
    [END]: END,
  })
  .addEdge(GraphNodes.Tools, GraphNodes.AgentWithChainOfThoughts);

const compiledGraph = workflow.compile({
  checkpointer: new MatrixCheckpointSaver(oracleName),
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
  ): Promise<TCustomerSupportGraphState> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    return this.graph.invoke(
      {
        messages: [new HumanMessage(input)],
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
  ): Promise<IterableReadableStream<StreamEvent>> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    const stream = this.graph.streamEvents(
      {
        messages: [new HumanMessage(input)],
      } satisfies Partial<TCustomerSupportGraphState>,

      {
        version: 'v2',
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
