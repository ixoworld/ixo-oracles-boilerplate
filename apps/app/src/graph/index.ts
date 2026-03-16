import {
  type IRunnableConfigWithRequiredFields,
  MatrixManager,
} from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { type BaseMessage, HumanMessage, type ReactAgent } from 'langchain';
import {
  type AgActionDto,
  type BrowserToolCallDto,
} from 'src/messages/dto/send-message.dto';
import { type UcanService } from 'src/ucan/ucan.service';
import { type FileProcessingService } from 'src/messages/file-processing.service';
import { createMainAgent } from './agents/main-agent';
import { getLLMProvider, getModelForRole } from './llm-provider';
import { type MCPUCANContext } from './mcp';
import { type TMainAgentGraphState } from './state';

/**
 * Resolve a page title from the Matrix room name state event.
 * Returns undefined if the room is unknown or the lookup fails.
 */
async function resolvePageTitle(roomId: string): Promise<string | undefined> {
  try {
    const client = MatrixManager.getInstance().getClient();
    if (!client) return undefined;
    const ev = await client.mxClient.getRoomStateEvent(
      roomId,
      'm.room.name',
      '',
    );
    return (ev as { name?: string })?.name ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Injects page context into the agent's messages. Always resolves the current
 * page title so the agent knows which page is active. When a page switch is
 * detected (previous editorRoomId differs), adds extra context about the switch.
 * Logging added for each step.
 */
async function injectPageSwitchMarker(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReactAgent<any>,
  currentEditorRoomId: string | undefined,
  messages: BaseMessage[],
  config: Record<string, unknown>,
): Promise<BaseMessage[]> {
  Logger.log(
    '[injectPageSwitchMarker] Called with editorRoomId:',
    currentEditorRoomId,
  );

  if (!currentEditorRoomId) {
    Logger.log(
      '[injectPageSwitchMarker] No currentEditorRoomId provided. Returning original messages.',
    );
    return messages;
  }

  Logger.log('[injectPageSwitchMarker] Resolving current page title...');
  const currentTitle = await resolvePageTitle(currentEditorRoomId);
  Logger.log(
    '[injectPageSwitchMarker] Current page title resolved:',
    currentTitle,
  );

  const currentLabel = currentTitle
    ? `"${currentTitle}" (${currentEditorRoomId})`
    : currentEditorRoomId;

  try {
    Logger.log('[injectPageSwitchMarker] Fetching agent graph state...');
    const snapshot = await agent.graph.getState(config);

    const previousState = snapshot?.values as TMainAgentGraphState | undefined;
    Logger.log('[injectPageSwitchMarker] Agent graph state fetched.', {
      previousState: {
        editorRoomId: previousState?.editorRoomId,
      },
    });
    const previousEditorRoomId = previousState?.editorRoomId;
    Logger.log(
      '[injectPageSwitchMarker] Previous editorRoomId:',
      previousEditorRoomId,
    );

    // Page switch detected
    if (previousEditorRoomId && previousEditorRoomId !== currentEditorRoomId) {
      Logger.log(
        '[injectPageSwitchMarker] Page switch detected from',
        previousEditorRoomId,
        'to',
        currentEditorRoomId,
      );
      Logger.log('[injectPageSwitchMarker] Resolving previous page title...');
      const previousTitle = await resolvePageTitle(previousEditorRoomId);
      Logger.log(
        '[injectPageSwitchMarker] Previous page title resolved:',
        previousTitle,
      );

      const previousLabel = previousTitle
        ? `"${previousTitle}" (${previousEditorRoomId})`
        : previousEditorRoomId;

      const marker = new HumanMessage({
        content:
          `[System: The user has switched pages. ` +
          `Current page: ${currentLabel}. ` +
          `Previous page: ${previousLabel}. ` +
          `Previous page context in conversation history may be stale. ` +
          `Always favour the current active page. ` +
          `Before making any edits, use read_page to confirm the current page content ` +
          `and verify it matches what the user is asking you to work on. ` +
          `If the content differs from what was discussed, confirm with the user before editing.]`,
        additional_kwargs: { lc_source: 'page_switch_marker' },
      });

      Logger.log(
        '[injectPageSwitchMarker] Injecting page switch marker and returning messages.',
      );
      return [marker, ...messages];
    } else {
      Logger.log(
        '[injectPageSwitchMarker] No page switch detected. (Previous and current editorRoomId are the same or previous is undefined.)',
      );
    }
  } catch (err) {
    Logger.warn(
      '[injectPageSwitchMarker] Error fetching agent state or resolving titles.',
      err,
    );
    // No checkpoint yet — first message, fall through to context-only marker
  }

  // No switch (or first message / same page) — still inject current page context
  Logger.log(
    '[injectPageSwitchMarker] Injecting current page context marker and returning messages.',
  );
  const contextMarker = new HumanMessage({
    content: `[System: Current active page: ${currentLabel}. Always work with this page.]`,
    additional_kwargs: { lc_source: 'page_context' },
  });
  return [contextMarker, ...messages];
}

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
    input: string | BaseMessage[],
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
    fileProcessingService?: FileProcessingService,
    spaceId?: string,
  ): Promise<Pick<TMainAgentGraphState, 'messages'>> {
    if (!runnableConfig.configurable.sessionId) {
      throw new Error('sessionId is required');
    }

    const messages: BaseMessage[] =
      typeof input === 'string'
        ? [
            new HumanMessage({
              content: input,
              additional_kwargs: {
                msgFromMatrixRoom,
                timestamp: new Date().toISOString(),
              },
            }),
          ]
        : input;

    Logger.log(
      `[sendMessage]: msgFromMatrixRoom: ${msgFromMatrixRoom} messages: ${messages.length}`,
    );

    // Build UCAN context if invocations are provided
    const mcpUcanContext: MCPUCANContext | undefined =
      ucanOptions?.mcpInvocations
        ? { invocations: ucanOptions.mcpInvocations }
        : undefined;

    const state = {
      messages,
      browserTools,
      editorRoomId,
      currentEntityDid,
      spaceId,
      client: clientType ?? 'portal',
      mcpUcanContext,
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
    } satisfies Partial<TMainAgentGraphState>;

    const configModelOverride = (
      runnableConfig.configurable as Record<string, unknown>
    ).modelOverride as string | undefined;

    const agent = await createMainAgent({
      state,
      config: {
        ...runnableConfig,
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: runnableConfig.configurable.sessionId,
        },
      },
      ucanService: ucanOptions?.ucanService,
      fileProcessingService,
      modelOverride: configModelOverride,
    });

    const invokeConfig = {
      ...runnableConfig,
      recursionLimit: 150,
      configurable: {
        ...runnableConfig.configurable,
        thread_id: runnableConfig.configurable.sessionId,
      },
    };

    const finalMessages = await injectPageSwitchMarker(
      agent,
      editorRoomId,
      messages,
      invokeConfig,
    );

    const result = await agent.invoke(
      { messages: finalMessages, editorRoomId },
      {
        ...invokeConfig,
        metadata: {
          llmProvider: getLLMProvider(),
          llmModel: configModelOverride ?? getModelForRole('main'),
        },
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
    input: string | BaseMessage[],
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
    fileProcessingService?: FileProcessingService,
    spaceId?: string,
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

    const messages: BaseMessage[] =
      typeof input === 'string'
        ? [
            new HumanMessage({
              content: input,
              additional_kwargs: {
                msgFromMatrixRoom,
                timestamp: new Date().toISOString(),
              },
            }),
          ]
        : input;

    // Build UCAN context if invocations are provided
    const mcpUcanContext: MCPUCANContext | undefined =
      ucanOptions?.mcpInvocations
        ? { invocations: ucanOptions.mcpInvocations }
        : undefined;

    const state = {
      messages,
      browserTools,
      editorRoomId,
      currentEntityDid,
      spaceId,
      client: 'portal',
      mcpUcanContext,
      ...(initialUserContext ? { userContext: initialUserContext } : {}),
      agActions,
    } satisfies Partial<TMainAgentGraphState>;

    const agent = await createMainAgent({
      state,
      config: {
        ...runnableConfig,
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
        },
      },
      ucanService: ucanOptions?.ucanService,
      fileProcessingService,
    });

    const streamConfig = {
      ...runnableConfig,
      recursionLimit: 150,
      configurable: {
        ...runnableConfig.configurable,
      },
    };

    const finalMessages = await injectPageSwitchMarker(
      agent,
      editorRoomId,
      messages,
      streamConfig,
    );

    const stream = agent.streamEvents(
      { messages: finalMessages, editorRoomId },
      {
        version: 'v2',
        ...runnableConfig,
        streamMode: ['updates', 'messages'] as const,
        recursionLimit: 150,
        configurable: {
          ...runnableConfig.configurable,
          llmProvider: getLLMProvider(),
          llmModel: getModelForRole('main'),
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
        spaceId: undefined,
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
