import { jsonToYaml, parserActionTool, parserBrowserTool } from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { OpenIdTokenProvider } from '@ixo/oracles-chain-client';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import { createAgent, type ReactAgent, toolRetryMiddleware } from 'langchain';
import { getConfig } from 'src/config';
import { type UcanService } from 'src/ucan/ucan.service';

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
import { createApplySandboxOutputToBlockTool } from './editor/apply-sandbox-output-to-block';
import { createEditorAgent } from './editor/editor-agent';
import { EditorMatrixClient } from './editor/editor-mx';
import {
  logEditorSessionToMemory,
  type PageMemoryAuth,
} from './editor/page-memory';
import { createPageTools } from './editor/page-tools';
import { EDITOR_DOCUMENTATION_CONTENT } from './editor/prompts';
import { createFirecrawlAgent } from './firecrawl-agent';
import { createMemoryAgent } from './memory-agent';
import { createPortalAgent } from './portal-agent';
import { createSubagentAsTool, type AgentSpec } from './subagent-as-tool';

import { DynamicStructuredTool } from 'langchain';
import fs from 'node:fs';
import path from 'node:path';
import {
  type FileProcessingService,
  type SandboxUploadConfig,
} from 'src/messages/file-processing.service';
import { SecretsService } from 'src/secrets/secrets.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import oracleConfig from '../../../oracle.config.json';
import { getProviderChatModel } from '../llm-provider';
import {
  createMCPClient,
  createMCPClientAndGetTools,
  createMCPClientAndGetToolsWithUCAN,
} from '../mcp';
import { createFileProcessingTool } from '../nodes/tools-node/file-processing-tool';
import { createListRoomFilesTool } from '../nodes/tools-node/list-room-files-tool';
import {
  listSkillsTool,
  searchSkillsTool,
} from '../nodes/tools-node/skills-tools';

function buildOracleContext(oc: typeof oracleConfig): string {
  const lines: string[] = [];
  if (oc.oracleName) lines.push(`**Name:** ${oc.oracleName}`);
  if (oc.orgName) lines.push(`**Organization:** ${oc.orgName}`);
  if (oc.description) lines.push(`**Purpose:** ${oc.description}`);
  if (oc.location) lines.push(`**Location:** ${oc.location}`);
  return lines.join('\n');
}
interface InvokeMainAgentParams {
  state: Partial<TMainAgentGraphState>;
  config: IRunnableConfigWithRequiredFields;
  /** Optional UCAN service for MCP tool authorization */
  ucanService?: UcanService;
  /** Optional file processing service for the process_file tool */
  fileProcessingService?: FileProcessingService;
}

const configService = getConfig();
const llm = getProviderChatModel('main', {});

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
Promise<ReactAgent<any>> => {
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

  // Build memory auth for page/block operation tracking
  const pageMemoryAuth: PageMemoryAuth | undefined =
    oracleOpenIdToken &&
    configurable.configs?.user.matrixOpenIdToken &&
    matrix?.roomId
      ? {
          oracleToken: oracleOpenIdToken,
          userToken: configurable.configs.user.matrixOpenIdToken,
          oracleHomeServer: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
          userHomeServer: configurable.configs.matrix.homeServerName ?? '',
          chatRoomId: matrix.roomId,
        }
      : undefined;

  Logger.log(
    `[createMainAgent] PageMemory auth ${pageMemoryAuth ? 'available' : 'unavailable (missing tokens or roomId)'}`,
  );

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

  // Build sandbox upload config for file processing (HTTP upload, no MCP needed)
  const sandboxUploadConfig: SandboxUploadConfig | undefined =
    configurable.configs?.user.matrixOpenIdToken && oracleOpenIdToken
      ? {
          sandboxMcpUrl: configService.getOrThrow('SANDBOX_MCP_URL'),
          userToken: configurable.configs.user.matrixOpenIdToken,
          oracleToken: oracleOpenIdToken,
          homeServerName: configurable.configs.matrix.homeServerName,
          oracleHomeServerUrl: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
        }
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

  // System prompt is critical — failure here is a code bug, not a transient issue
  const systemPrompt = await AI_ASSISTANT_PROMPT.format({
    APP_NAME:
      oracleConfig.oracleName || configService.get('ORACLE_NAME') || 'Oracle',
    ORACLE_CONTEXT: buildOracleContext(oracleConfig),
    IDENTITY_CONTEXT: jsonToYaml(state?.userContext?.identity ?? {}),
    WORK_CONTEXT: jsonToYaml(state?.userContext?.work ?? {}),
    GOALS_CONTEXT: jsonToYaml(state?.userContext?.goals ?? {}),
    INTERESTS_CONTEXT: jsonToYaml(state?.userContext?.interests ?? {}),
    RELATIONSHIPS_CONTEXT: jsonToYaml(state?.userContext?.relationships ?? {}),
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
  });

  // Track MCP/agent failures so the agent knows which capabilities are degraded
  const unavailableServices: string[] = [];

  /** Extract a value from a settled result, logging and tracking failures. */
  const settled = <T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    name: string,
  ): T => {
    if (result.status === 'fulfilled') return result.value;
    Logger.error(
      `[createMainAgent] ${name} failed to initialize: ${String(result.reason)}`,
    );
    unavailableServices.push(name);
    return fallback;
  };

  const [
    portalResult,
    memoryResult,
    firecrawlResult,
    domainIndexerResult,
    mcpToolsResult,
    sandboxResult,
  ] = await Promise.allSettled([
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

  const portalAgent = settled(portalResult, null, 'Portal Agent');
  const memoryAgent = settled(
    memoryResult,
    null,
    'Memory Agent (memory-engine MCP)',
  );
  const firecrawlAgent = settled(
    firecrawlResult,
    null,
    'Firecrawl Agent (firecrawl MCP)',
  );
  const domainIndexerAgent = settled(
    domainIndexerResult,
    null,
    'Domain Indexer Agent',
  );
  const mcpTools = settled(mcpToolsResult, [], 'MCP tools');
  const sandboxTools = settled(sandboxResult, [], 'Sandbox MCP');

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
    Logger.log(`Editor room ID provided: ${state.editorRoomId}`);
    Logger.log('Initializing BlockNote tools...');
    // Derive user's Matrix ID from DID + homeserver for page invitations
    const userDid = configurable?.configs?.user?.did;
    const homeServer = configurable?.configs?.matrix?.homeServerName;
    const userMatrixId =
      userDid && homeServer
        ? `@${userDid.replace(/:/g, '-')}:${homeServer}`
        : undefined;
    try {
      blockNoteAgentSpec = await createEditorAgent({
        room: state.editorRoomId,
        mode: 'edit',
        userMatrixId,
        spaceId: state.spaceId,
        memoryAuth: pageMemoryAuth,
      });
    } catch (error) {
      Logger.error(
        `[createMainAgent] Editor Agent failed to initialize: ${String(error)}`,
      );
      unavailableServices.push('Editor Agent');
    }
  }

  // Create standalone page tools when spaceId is present but no editor session
  let standalonePageTools: ReturnType<typeof createPageTools> | null = null;
  if (!state.editorRoomId && state.spaceId) {
    try {
      const editorMatrixClient = EditorMatrixClient.getInstance();
      await editorMatrixClient.waitUntilReady();
      const matrixClient = editorMatrixClient.getClient();
      const userDid = configurable?.configs?.user?.did;
      const homeServer = configurable?.configs?.matrix?.homeServerName;
      const userMatrixId =
        userDid && homeServer
          ? `@${userDid.replace(/:/g, '-')}:${homeServer}`
          : undefined;
      standalonePageTools = createPageTools(
        matrixClient,
        userMatrixId,
        state.spaceId,
        pageMemoryAuth,
      );
      Logger.log(
        `Created standalone page tools with spaceId: ${state.spaceId}`,
      );
    } catch (error) {
      Logger.error(
        `[createMainAgent] Standalone page tools failed to initialize: ${String(error)}`,
      );
      unavailableServices.push('Page Tools');
    }
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

  // Helper to inject time context into sub-agent system prompts
  const withTimeContext = (spec: AgentSpec): AgentSpec => ({
    ...spec,
    systemPrompt: `${spec.systemPrompt}\n\n## Current Time\n${timeContext}`,
  });

  const callPortalAgentTool = portalAgent
    ? createSubagentAsTool(withTimeContext(portalAgent))
    : null;
  const callMemoryAgentTool = memoryAgent
    ? createSubagentAsTool(withTimeContext(memoryAgent))
    : null;
  const callFirecrawlAgentTool = firecrawlAgent
    ? createSubagentAsTool(withTimeContext(firecrawlAgent))
    : null;
  const callDomainIndexerAgentTool = domainIndexerAgent
    ? createSubagentAsTool(withTimeContext(domainIndexerAgent))
    : null;
  const callEditorAgentTool = blockNoteAgentSpec
    ? createSubagentAsTool(withTimeContext(blockNoteAgentSpec), {
        forwardTools: ['create_page', 'update_page'],
        onComplete: pageMemoryAuth
          ? (messages, query) =>
              logEditorSessionToMemory(
                pageMemoryAuth,
                messages,
                state.editorRoomId!,
                query,
              )
          : undefined,
      })
    : null;

  // Build degraded-services notice for the system prompt
  let finalSystemPrompt = systemPrompt;
  if (unavailableServices.length > 0) {
    const serviceList = unavailableServices.map((s) => `- ${s}`).join('\n');
    finalSystemPrompt += `\n\n---\n\n## DEGRADED SERVICES\n\nThe following services failed to initialize and are temporarily unavailable. Do NOT attempt to use their tools — they will not work. Inform the user if they request functionality that depends on these services and suggest they try again later.\n\n${serviceList}\n`;
    Logger.warn(
      `[createMainAgent] ${unavailableServices.length} service(s) unavailable: ${unavailableServices.join(', ')}`,
    );
  }

  // check db folder if not exists, create it
  const dbFolder = path.join(
    UserMatrixSqliteSyncService.checkpointsFolder,
    configurable?.configs?.user?.did,
  );
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }

  // Build middleware list conditionally
  const disableCredits = configService.get('DISABLE_CREDITS');

  const middleware = [createToolValidationMiddleware(), toolRetryMiddleware()];

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
      ...(callPortalAgentTool ? [callPortalAgentTool] : []),
      ...(callMemoryAgentTool ? [callMemoryAgentTool] : []),
      ...(callFirecrawlAgentTool ? [callFirecrawlAgentTool] : []),
      ...(callDomainIndexerAgentTool ? [callDomainIndexerAgentTool] : []),
      ...(callEditorAgentTool ? [callEditorAgentTool] : []),
      ...(fileProcessingService
        ? [
            createFileProcessingTool(
              fileProcessingService,
              matrix?.roomId,
              sandboxUploadConfig,
            ),
          ]
        : []),
      ...(matrix?.roomId ? [createListRoomFilesTool(matrix.roomId)] : []),
      ...(applySandboxOutputToBlockTool ? [applySandboxOutputToBlockTool] : []),
      ...(standalonePageTools
        ? [standalonePageTools.createPageTool, standalonePageTools.readPageTool]
        : []),
    ],
    middleware,
    systemPrompt: finalSystemPrompt,
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
