import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { HumanMessage } from 'langchain';
import { type BrowserToolCallDto } from 'src/messages/dto/send-message.dto';
import { type UcanService } from 'src/ucan/ucan.service';
import { createMainAgent } from './agents/main-agent';
import { type MCPUCANContext } from './mcp';
import { type TMainAgentGraphState } from './state';

import { type AgActionDto } from 'src/messages/dto/send-message.dto';

/**
 * Options for agent methods that support UCAN
 */
interface UCANOptions {
  /** UCAN service for MCP tool authorization */
  ucanService?: UcanService;
  /** Map of tool names to serialized invocations */
  mcpInvocations?: Record<string, string>;
}

export class MainAgentGraph {
  async sendMessage(
    input: string,
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    },
    browserTools?: BrowserToolCallDto[],
    msgFromMatrixRoom = false,
    initialUserContext?: TMainAgentGraphState['userContext'],
    editorRoomId?: string,
    currentEntityDid?: string,
    clientType?: 'matrix' | 'slack',
    ucanOptions?: UCANOptions,
  ): Promise<Pick<TMainAgentGraphState, 'messages'>> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    Logger.log(
      `[sendMessage]: msgFromMatrixRoom: ${msgFromMatrixRoom} input: ${input}`,
    );

    // Build UCAN context if invocations are provided
    const mcpUcanContext: MCPUCANContext | undefined =
      ucanOptions?.mcpInvocations
        ? { invocations: ucanOptions.mcpInvocations }
        : undefined;

    const state = {
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
      mcpUcanContext,
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
    } satisfies Partial<TMainAgentGraphState>;

    const agent = await createMainAgent({
      state: state,
      config: {
        ...runnableConfig,
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: runnableConfig.configurable.sessionId,
        },
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
      },
      ucanService: ucanOptions?.ucanService,
    });

    const result = await agent.invoke(
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
      },
      {
        context: {
          userDid: runnableConfig.configurable.configs?.user.did ?? '',
        },
        durability: 'async',
      },
    );

    return {
      messages: result.messages,
    };
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
    initialUserContext?: TMainAgentGraphState['userContext'],
    abortController?: AbortController,
    editorRoomId?: string,
    currentEntityDid?: string,
    agActions?: AgActionDto[],
    ucanOptions?: UCANOptions,
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

    // Build UCAN context if invocations are provided
    const mcpUcanContext: MCPUCANContext | undefined =
      ucanOptions?.mcpInvocations
        ? { invocations: ucanOptions.mcpInvocations }
        : undefined;

    const state = {
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
      client: 'portal',
      mcpUcanContext,
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
      agActions,
    } satisfies Partial<TMainAgentGraphState>;

    const agent = await createMainAgent({
      state: state,
      config: {
        ...runnableConfig,
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
        },
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
      },
      ucanService: ucanOptions?.ucanService,
    });

    const stream = agent.streamEvents(
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
        agActions,
        mcpUcanContext,
        ...(initialUserContext ? { userContext: initialUserContext } : {}),
        editorRoomId,
        currentEntityDid,
      } satisfies Partial<TMainAgentGraphState>,

      {
        version: 'v2',
        ...runnableConfig,
        streamMode: 'messages',
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
        },
        context: {
          userDid: runnableConfig.configurable.configs?.user.did ?? '',
        },
        // Signal must be last to ensure it's not overwritten by runnableConfig spread
        signal: abortController?.signal,
      },
    );

    return stream;
  }

  public async getGraphState(
    config: IRunnableConfigWithRequiredFields & {
      sessionId: string;
    },
  ): Promise<Pick<TMainAgentGraphState, 'messages'> | undefined> {
    const agent = await createMainAgent({
      state: {
        messages: [],
        browserTools: [],
        editorRoomId: undefined,
        currentEntityDid: undefined,
        client: 'portal',
        userContext: undefined,
      } satisfies Partial<TMainAgentGraphState>,
      config: {
        ...config,
        recursionLimit: 150,
        configurable: {
          ...config.configurable,
        },
      },
    });
    const state =
      (await agent.graph.getState(config)) ?? agent.getState(config);
    if (Object.keys(state.values as TMainAgentGraphState).length === 0) {
      return undefined;
    }
    return state.values as TMainAgentGraphState;
  }
}

export const mainAgent = new MainAgentGraph();
