import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { HumanMessage } from 'langchain';
import { type BrowserToolCallDto } from 'src/messages/dto/send-message.dto';
import { createMainAgent } from './agents/main-agent';
import { type TMainAgentGraphState } from './state';

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
  ): Promise<Pick<TMainAgentGraphState, 'messages'>> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }
    Logger.log(
      `[sendMessage]: msgFromMatrixRoom: ${msgFromMatrixRoom} input: ${input}`,
    );

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
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
    } satisfies Partial<TMainAgentGraphState>;

    const agent = await createMainAgent({
      state: state,
      config: {
        ...runnableConfig,
        recursionLimit: 50,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: runnableConfig.configurable.sessionId,
        },
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
      },
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
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
    } satisfies Partial<TMainAgentGraphState>;

    const agent = await createMainAgent({
      state: state,
      config: {
        ...runnableConfig,
        recursionLimit: 50,
        configurable: {
          ...runnableConfig.configurable,
        },
        metadata: {
          langfuseSessionId: runnableConfig.configurable.sessionId,
          langfuseUserId: runnableConfig.configurable.configs?.user.did,
        },
      },
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
        ...(initialUserContext ? { userContext: initialUserContext } : {}),
        editorRoomId,
        currentEntityDid,
      } satisfies Partial<TMainAgentGraphState>,

      {
        version: 'v2',
        ...runnableConfig,
        streamMode: 'messages',
        recursionLimit: 50,
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
        recursionLimit: 50,
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
