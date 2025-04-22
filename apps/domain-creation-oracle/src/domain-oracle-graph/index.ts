import { ORACLE_NAME } from '@/config.js';
import {
  IRunnableConfigWithRequiredFields,
  MatrixCheckpointSaver,
} from '@ixo/matrix';
import { HumanMessage } from '@langchain/core/messages';
import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { END, START, StateGraph } from '@langchain/langgraph';
import { CallbackHandler } from 'langfuse-langchain';
import { domainCreatorNode } from './nodes/domain-creator.node.js';
import genericChatNode from './nodes/generic-chat.node.js';
import { toolsNode } from './nodes/tools/tools.nodes.js';
import { intentRouter } from './routers/intent.router.js';
import toolsChatRouter from './routers/tools-chat.router.js';
import {
  DomainCreationOracleState,
  domainCreationOracleState,
} from './state.js';
import { GraphNodes } from './types.js';

const langfuseHandler = new CallbackHandler({
  secretKey: 'sk-lf-1b73f7a8-c83f-4226-b4d6-32b8f5f6b917',
  publicKey: 'pk-lf-e261489e-20ce-4a26-a554-b88b58658598',
  baseUrl: 'http://localhost:3000', // 🇪🇺 EU region
  flushInterval: 2,
});
const workflow = new StateGraph(domainCreationOracleState)

  // Nodes
  .addNode(GraphNodes.DomainCreationOracle, domainCreatorNode)
  .addNode(GraphNodes.GenericChat, genericChatNode)
  .addNode(GraphNodes.Tools, toolsNode)
  .addNode(GraphNodes.ToolsChat, toolsNode)

  // Routes
  .addConditionalEdges(START, intentRouter)

  .addConditionalEdges(GraphNodes.GenericChat, toolsChatRouter, {
    [GraphNodes.Tools]: GraphNodes.ToolsChat,
    [END]: END,
  })
  .addConditionalEdges(GraphNodes.DomainCreationOracle, toolsChatRouter)
  .addEdge(GraphNodes.Tools, GraphNodes.DomainCreationOracle)
  .addEdge(GraphNodes.ToolsChat, GraphNodes.GenericChat)
  .addEdge(GraphNodes.GenericChat, END)
  .addEdge(GraphNodes.DomainCreationOracle, END);

const compiledGraph = workflow.compile({
  checkpointer: new MatrixCheckpointSaver(ORACLE_NAME),
});

export class DomainCreationOracle {
  constructor(private readonly graph = compiledGraph) {}

  async sendMessage(
    input: string,
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    },
  ): Promise<DomainCreationOracleState> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    return this.graph.invoke(
      {
        messages: [new HumanMessage(input)],
      } satisfies Partial<DomainCreationOracleState>,

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
          langfuseUserId: runnableConfig.configurable.configs?.user?.did,
        },
      },
    ) as Promise<DomainCreationOracleState>;
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
      } satisfies Partial<DomainCreationOracleState>,

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
          langfuseUserId: runnableConfig.configurable.configs?.user?.did,
        },
      },
    );

    return stream;
  }

  public async getGraphState({
    matrixAccessToken,
    roomId,
    sessionId,
    did,
  }: {
    matrixAccessToken: string;
    roomId: string;
    sessionId: string;
    did: string;
  }): Promise<DomainCreationOracleState | undefined> {
    const state = await this.graph.getState({
      configurable: {
        thread_id: sessionId,
        configs: {
          matrix: {
            accessToken: matrixAccessToken,
            roomId,
          },
          user: {
            did,
          },
        },
      },
    });
    if (Object.keys(state.values).length === 0) {
      return undefined;
    }
    return state.values as DomainCreationOracleState;
  }
}

export const domainCreationOracleGraph = new DomainCreationOracle();
