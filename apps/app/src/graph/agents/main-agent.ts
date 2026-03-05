import {
  getOpenRouterChatModel,
  jsonToYaml,
  parserActionTool,
  parserBrowserTool,
  type SearchEnhancedResponse,
  type FactResult,
  type EntityResult,
  type EpisodeResult,
} from '@ixo/common';
import { OpenIdTokenProvider } from '@ixo/oracles-chain-client';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAgent, type ReactAgent, toolRetryMiddleware } from 'langchain';
import { type ENV } from 'src/config';
import { type UcanService } from 'src/ucan/ucan.service';
import { createSafetyGuardrailMiddleware } from '../middlewares/safety-guardrail-middleware';
import { createTokenLimiterMiddleware } from '../middlewares/token-limiter-middelware';
import { createToolValidationMiddleware } from '../middlewares/tool-validation-middleware';
import {
  AG_UI_TOOLS_DOCUMENTATION,
  AI_ASSISTANT_PROMPT,
  SLACK_FORMATTING_CONSTRAINTS_CONTENT,
} from '../nodes/chat-node/prompt';
import { type TMainAgentGraphState } from '../state';
import { contextSchema } from '../types';
import { createDomainIndexerAgent } from './domain-indexer-agent';
import { createEditorAgent } from './editor/editor-agent';
import { EDITOR_DOCUMENTATION_CONTENT } from './editor/prompts';
import { createFirecrawlAgent } from './firecrawl-agent';
import { createMemoryAgent } from './memory-agent';
import { createPortalAgent } from './portal-agent';
import { createSubagentAsTool } from './subagent-as-tool';
import { createApplySandboxOutputToBlockTool } from './editor/apply-sandbox-output-to-block';

import { DynamicStructuredTool } from 'langchain';
import fs from 'node:fs';
import path from 'node:path';
import { SecretsService } from 'src/secrets/secrets.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import {
  createMCPClient,
  createMCPClientAndGetTools,
  createMCPClientAndGetToolsWithUCAN,
} from '../mcp';
import {
  listSkillsTool,
  searchSkillsTool,
} from '../nodes/tools-node/skills-tools';
import { createFileProcessingTool } from '../nodes/tools-node/file-processing-tool';
import { createListRoomFilesTool } from '../nodes/tools-node/list-room-files-tool';
import { type FileProcessingService } from 'src/messages/file-processing.service';
interface InvokeMainAgentParams {
  state: Partial<TMainAgentGraphState>;
  config: IRunnableConfigWithRequiredFields;
  /** Optional UCAN service for MCP tool authorization */
  ucanService?: UcanService;
  /** Optional file processing service for the process_file tool */
  fileProcessingService?: FileProcessingService;
}

const configService = new ConfigService<ENV>();
const llm = getOpenRouterChatModel({
  model: 'openai/gpt-oss-120b:nitro',
  // model: 'moonshotai/kimi-k2.5',
  // model: 'minimax/minimax-m2.5',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});

const oracleMatrixBaseUrl = configService
  .getOrThrow('MATRIX_BASE_URL')
  .replace(/\/$/, '');

const oracleOpenIdTokenProvider = new OpenIdTokenProvider({
  matrixAccessToken: configService.getOrThrow(
    'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
  ),
  homeServerUrl: oracleMatrixBaseUrl,
  matrixUserId: configService.getOrThrow('MATRIX_ORACLE_ADMIN_USER_ID'),
});

export const createMainAgent = async ({
  state,
  config,
  ucanService,
  fileProcessingService,
}: InvokeMainAgentParams): // eslint-disable-next-line @typescript-eslint/no-explicit-any
Promise<ReactAgent<any, any, any, any>> => {
  const msgFromMatrixRoom = Boolean(
    state.messages?.at(-1)?.additional_kwargs.msgFromMatrixRoom,
  );

  const { configurable } = config;
  const { matrix } = configurable?.configs ?? {};
  Logger.log(
    `[createMainAgent] homeServerName: ${configurable.configs?.matrix.homeServerName}`,
  );
  const oracleOpenIdToken = configurable.configs?.user.matrixOpenIdToken
    ? await oracleOpenIdTokenProvider.getToken()
    : undefined;

  // Load secret index (cheap — one state query per message)
  const roomId = configurable.configs?.matrix.roomId;
  const secretIndex = roomId
    ? await SecretsService.getInstance().getSecretIndex(roomId)
    : [];

  // Build base headers for sandbox MCP (auth only — secrets added lazily)
  const sandboxHeaders: Record<string, string> = {
    Authorization: `Bearer ${configurable.configs?.user.matrixOpenIdToken}`,
    'x-matrix-homeserver': configurable.configs?.matrix.homeServerName ?? '',
    'X-oracle-openid-token': oracleOpenIdToken ?? '',
    'x-oracle-homeserver': oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
  };

  // Create sandbox MCP with auth headers (for tool schema discovery)
  const sandboxMCP =
    configurable.configs?.user.matrixOpenIdToken && oracleOpenIdToken
      ? createMCPClient({
          mcpServers: {
            sandbox: {
              type: 'http',
              url: configService.getOrThrow('SANDBOX_MCP_URL'),
              transport: 'http',
              headers: sandboxHeaders,
            },
          },
          defaultToolTimeout: 180_000,
        })
      : undefined;
  Logger.log(`msgFromMatrixRoom: ${msgFromMatrixRoom}`);

  // Extract timezone and current time from config
  const userConfig = configurable?.configs?.user;
  const timezone = userConfig?.timezone;
  const currentTime = userConfig?.currentTime;

  // Format time context
  const timeContext = formatTimeContext(timezone, currentTime);

  if (!configurable?.configs?.user?.did) {
    throw new Error('User DID is required');
  }
  if (!configurable.thread_id) {
    throw new Error('Thread ID is required');
  }

  const agActionTools =
    state.agActions && state.agActions.length > 0
      ? state.agActions.map((action) => parserActionTool(action))
      : [];

  // Create MCP tools - use UCAN-wrapped version if service is available
  const getMcpTools = async () => {
    if (ucanService) {
      // Use UCAN-wrapped tools that validate invocations
      return createMCPClientAndGetToolsWithUCAN(
        ucanService,
        () => state.mcpUcanContext,
      );
    }
    // Fallback to non-UCAN tools
    return createMCPClientAndGetTools();
  };

  const [
    systemPrompt,
    portalAgent,
    memoryAgent,
    firecrawlAgent,
    domainIndexerAgent,
    mcpTools,
    sandboxTools,
  ] = await Promise.all([
    AI_ASSISTANT_PROMPT.format({
      APP_NAME: 'IXO | IXO Portal',
      IDENTITY_CONTEXT: jsonToYaml(state?.userContext?.identity ?? {}),
      WORK_CONTEXT: jsonToYaml(state?.userContext?.work ?? {}),
      GOALS_CONTEXT: jsonToYaml(state?.userContext?.goals ?? {}),
      INTERESTS_CONTEXT: jsonToYaml(state?.userContext?.interests ?? {}),
      RELATIONSHIPS_CONTEXT: jsonToYaml(
        state?.userContext?.relationships ?? {},
      ),
      RECENT_CONTEXT: jsonToYaml(state?.userContext?.recent ?? {}),
      TIME_CONTEXT: timeContext,
      EDITOR_DOCUMENTATION: state.editorRoomId
        ? EDITOR_DOCUMENTATION_CONTENT
        : '',
      CURRENT_ENTITY_DID: state.currentEntityDid ?? '',
      SLACK_FORMATTING_CONSTRAINTS:
        state.client === 'slack' ? SLACK_FORMATTING_CONSTRAINTS_CONTENT : '',
      AG_UI_TOOLS_DOCUMENTATION:
        agActionTools.length > 0 ? AG_UI_TOOLS_DOCUMENTATION : '',
      USER_SECRETS_CONTEXT:
        secretIndex.length > 0
          ? secretIndex.map((s) => `- _USER_SECRET_${s.name}`).join('\n')
          : '',
    }),
    createPortalAgent({
      tools:
        state.browserTools?.map((tool) =>
          parserBrowserTool({
            description: tool.description,
            schema: tool.schema,
            toolName: tool.name,
          }),
        ) ?? [],
    }),
    createMemoryAgent({
      oracleToken: oracleOpenIdToken ?? '',
      userToken: configurable.configs?.user.matrixOpenIdToken ?? '',
      oracleHomeServer: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
      userHomeServer: configurable.configs?.matrix.homeServerName ?? '',
      roomId: matrix?.roomId ?? '',
      mode: 'user',
    }),
    createFirecrawlAgent(),
    createDomainIndexerAgent(),
    getMcpTools(),
    sandboxMCP?.getTools() ?? Promise.resolve([]),
  ]);

  // Wrap sandbox_run for lazy secret injection (both oracle and user secrets).
  // MCP adapters snapshot headers at construction time, so we create a new
  // MCP client with all secrets on first sandbox_run call.
  let enrichedRunTool: (typeof sandboxTools)[number] | null = null;
  let enrichedRunPromise: Promise<void> | null = null;

  const wrappedSandboxTools = sandboxTools.map((t) => {
    if (t.name !== 'sandbox_run') return t;

    return new DynamicStructuredTool({
      name: t.name,
      description: t.description,
      schema: t.schema,
      func: async (input) => {
        // Lazily create enriched MCP client on first sandbox_run call (promise-safe)
        if (!enrichedRunPromise) {
          enrichedRunPromise = (async () => {
            const enrichedHeaders = { ...sandboxHeaders };

            // Add oracle secrets as x-os-* headers
            const oracleSecretsStr = configService.get('ORACLE_SECRETS', '');
            if (oracleSecretsStr) {
              for (const pair of oracleSecretsStr.split(',')) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx > 0) {
                  const key = pair.slice(0, eqIdx).trim();
                  const val = pair.slice(eqIdx + 1).trim();
                  if (key && val)
                    enrichedHeaders[`x-os-${key.toLowerCase()}`] = val;
                }
              }
            }

            // Add user secrets as x-us-* headers
            if (secretIndex.length > 0 && roomId) {
              const values =
                await SecretsService.getInstance().loadSecretValues(
                  roomId,
                  secretIndex,
                );
              for (const [name, value] of Object.entries(values)) {
                enrichedHeaders[`x-us-${name.toLowerCase()}`] = value;
              }
            }

            const enrichedMCP = createMCPClient({
              mcpServers: {
                sandbox: {
                  type: 'http',
                  url: configService.getOrThrow('SANDBOX_MCP_URL'),
                  transport: 'http',
                  headers: enrichedHeaders,
                },
              },
              defaultToolTimeout: 180_000,
            });
            const enrichedTools = (await enrichedMCP?.getTools()) ?? [];
            enrichedRunTool =
              enrichedTools.find((et) => et.name === 'sandbox_run') ?? null;
          })();
        }

        await enrichedRunPromise;

        if (enrichedRunTool) {
          return enrichedRunTool.invoke(input);
        }
        // Fallback to original tool (without secrets)
        return t.invoke(input);
      },
    });
  });

  // Conditionally create BlockNote (editor) agent tool if editorRoomId is provided
  let blockNoteAgentSpec:
    | Awaited<ReturnType<typeof createEditorAgent>>
    | undefined;
  if (state.editorRoomId) {
    Logger.log(`📝 Editor room ID provided: ${state.editorRoomId}`);
    Logger.log('🔧 Initializing BlockNote tools...');
    blockNoteAgentSpec = await createEditorAgent({
      room: state.editorRoomId,
      mode: 'edit',
    });
  }

  // Create apply_sandbox_output_to_block tool when both sandbox and editor are available
  let applySandboxOutputToBlockTool: ReturnType<
    typeof createApplySandboxOutputToBlockTool
  > | null = null;
  if (state.editorRoomId) {
    const sandboxRunTool = wrappedSandboxTools.find(
      (t) => t.name === 'sandbox_run',
    );
    if (sandboxRunTool) {
      applySandboxOutputToBlockTool = createApplySandboxOutputToBlockTool({
        sandboxRunTool,
        editorRoomId: state.editorRoomId,
      });
      Logger.log('📦 Created apply_sandbox_output_to_block tool');
    }
  }

  const callPortalAgentTool = createSubagentAsTool(portalAgent);
  const callMemoryAgentTool = createSubagentAsTool(memoryAgent);
  const callFirecrawlAgentTool = createSubagentAsTool(firecrawlAgent);
  const callDomainIndexerAgentTool = createSubagentAsTool(domainIndexerAgent);
  const callEditorAgentTool = blockNoteAgentSpec
    ? createSubagentAsTool(blockNoteAgentSpec)
    : null;

  // check db folder if not exists, create it
  const dbFolder = path.join(
    UserMatrixSqliteSyncService.checkpointsFolder,
    configurable?.configs?.user?.did,
  );
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }

  // Build middleware list conditionally
  const disableCredits = configService.get('DISABLE_CREDITS', false);

  const middleware = [
    createToolValidationMiddleware(),
    toolRetryMiddleware(),
    createSafetyGuardrailMiddleware(),
  ];

  if (!disableCredits) {
    middleware.push(createTokenLimiterMiddleware());
  }

  const agent = createAgent({
    model: llm,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contextSchema: contextSchema as any,
    tools: [
      ...mcpTools,
      ...wrappedSandboxTools,
      ...agActionTools,
      listSkillsTool,
      searchSkillsTool,
      callPortalAgentTool,
      callMemoryAgentTool,
      callFirecrawlAgentTool,
      callDomainIndexerAgentTool,
      ...(callEditorAgentTool ? [callEditorAgentTool] : []),
      ...(fileProcessingService
        ? [createFileProcessingTool(fileProcessingService, matrix?.roomId)]
        : []),
      ...(matrix?.roomId ? [createListRoomFilesTool(matrix.roomId)] : []),
      ...(applySandboxOutputToBlockTool ? [applySandboxOutputToBlockTool] : []),
    ],
    middleware,
    systemPrompt,
    checkpointer: SqliteSaver.fromDatabase(
      await UserMatrixSqliteSyncService.getInstance().getUserDatabase(
        configurable?.configs?.user?.did,
      ),
    ),
    name: 'Companion Agent',
  });

  return agent;
};

// Helper function to format time context
const formatTimeContext = (
  timezone: string | undefined,
  currentTime: string | undefined,
): string => {
  if (!timezone && !currentTime) {
    return 'Not available.';
  }

  let context = '';

  if (currentTime) {
    context += `Current local time: ${currentTime}`;
  }

  if (timezone) {
    if (context) {
      context += `\nTimezone: ${timezone}`;
    } else {
      context += `Timezone: ${timezone}`;
    }
  }

  return context || 'Not available.';
};

// Helper function to format SearchEnhancedResponse into readable context
const _formatContextData = (data: SearchEnhancedResponse | undefined) => {
  if (!data) return 'No specific information available.';

  let context = '';

  if (data.facts && data.facts.length > 0) {
    context += '**Key Facts:**\n';
    data.facts.slice(0, 3).forEach((fact: FactResult) => {
      context += `- ${fact.fact}\n`;
    });
  }

  if (data.entities && data.entities.length > 0) {
    context += '\n**Relevant Entities:**\n';
    data.entities.slice(0, 3).forEach((entity: EntityResult) => {
      context += `- ${entity.name}: ${entity.summary}\n`;
    });
  }

  if (data.episodes && data.episodes.length > 0) {
    context += '\n**Recent Episodes:**\n';
    data.episodes.slice(0, 2).forEach((episode: EpisodeResult) => {
      context += `- ${episode.name}: ${episode.content.substring(0, 100)}...\n`;
    });
  }

  return context || 'No specific information available.';
};
