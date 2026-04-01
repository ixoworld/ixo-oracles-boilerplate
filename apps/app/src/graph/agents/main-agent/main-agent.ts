import { parserActionTool, parserBrowserTool } from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import {
  MultiServerMCPClient,
  type ClientConfig,
} from '@langchain/mcp-adapters';
import { OpenIdTokenProvider } from '@ixo/oracles-chain-client';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import {
  createAgent,
  toolRetryMiddleware,
  type ReactAgent,
  type StructuredTool,
} from 'langchain';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from 'src/config';
import { type FileProcessingService } from 'src/messages/file-processing.service';
import type { TaskExecutionContext } from 'src/tasks/processors/processor-utils';
import { type TasksService } from 'src/tasks/task.service';
import { type UcanService } from 'src/ucan/ucan.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import z from 'zod';

import { createPageContextMiddleware } from '../../middlewares/page-context-middleware';
import { createTokenLimiterMiddleware } from '../../middlewares/token-limiter-middelware';
import { createToolValidationMiddleware } from '../../middlewares/tool-validation-middleware';
import { getProviderChatModel } from '../../llm-provider';
import { createMCPClientAndGetTools } from '../../mcp';
import { createFileProcessingTool } from '../../nodes/tools-node/file-processing-tool';
import { createCheckSecretTool } from '../../nodes/tools-node/check-secret-tool';
import { createListRoomFilesTool } from '../../nodes/tools-node/list-room-files-tool';
import {
  listSkillsTool,
  searchSkillsTool,
} from '../../nodes/tools-node/skills-tools';
import { type TMainAgentGraphState } from '../../state';
import { contextSchema } from '../../types';

import { createAguiAgent } from '../agui-agent';
import { createDomainIndexerAgent } from '../domain-indexer-agent';
import { createApplySandboxOutputToBlockTool } from '../editor/apply-sandbox-output-to-block';
import { createEditorAgent } from '../editor/editor-agent';
import { logEditorSessionToMemory } from '../editor/page-memory';
import { createStandaloneEditorTool } from '../editor/standalone-editor-tool';
import { createFirecrawlAgent } from '../firecrawl-agent';
import { createMcpToolsAgentTool } from '../mcp-agent';
import { createMemoryAgent } from '../memory-agent';
import { createPortalAgent } from '../portal-agent';
import { createSubagentAsTool, type AgentSpec } from '../subagent-as-tool';
import { createTaskManagerAgent } from '../task-manager';

import { buildAuthContext } from './auth-headers';
import { buildOperationalMode } from './operational-mode';
import { oracleConfig } from './oracle-config';
import { buildSystemPrompt, formatTimeContext } from './prompt-builder';
import { wrapSandboxToolsWithSecrets } from './sandbox-tools';
import { deduplicateByUrl } from './url-dedup';

// ---------------------------------------------------------------------------
// Module-level setup
// ---------------------------------------------------------------------------

interface InvokeMainAgentParams {
  state: Partial<TMainAgentGraphState>;
  config: IRunnableConfigWithRequiredFields;
  /** Optional UCAN service for MCP tool authorization */
  ucanService?: UcanService;
  /** Optional file processing service for the process_file tool */
  fileProcessingService?: FileProcessingService;
  /** Optional model override — a provider model ID (e.g. from getModelForRole). When set, overrides the default 'main' model. */
  modelOverride?: string;
  /** Optional TasksService for the Task Manager sub-agent */
  tasksService?: TasksService;
}

const configService = getConfig();

// Use model from oracle.config.json if set, otherwise default
const llm = oracleConfig.model
  ? getProviderChatModel('main', { model: oracleConfig.model })
  : getProviderChatModel('main', {});

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

// ---------------------------------------------------------------------------
// Config MCP tools (from oracle.config.json — static, cached at module level)
// ---------------------------------------------------------------------------
const configMcpServers = deduplicateByUrl(oracleConfig.mcpServers ?? []);

let configMcpToolsPromise: Promise<StructuredTool[]> | null = null;

function getConfigMcpTools(): Promise<StructuredTool[]> {
  if (configMcpToolsPromise) return configMcpToolsPromise;

  if (configMcpServers.length === 0) {
    configMcpToolsPromise = Promise.resolve([]);
    return configMcpToolsPromise;
  }

  configMcpToolsPromise = (async () => {
    const serverConfig: ClientConfig['mcpServers'] = {};
    for (const s of configMcpServers) {
      serverConfig[s.name] = { type: 'http', url: s.url, transport: 'http' };
    }
    try {
      const client = new MultiServerMCPClient({
        prefixToolNameWithServerName: true,
        useStandardContentBlocks: true,
        defaultToolTimeout: 120_000,
        mcpServers: serverConfig,
      });
      const tools = await client.getTools();
      Logger.log(
        `Config MCP servers: ${tools.length} tool(s) from ${configMcpServers.length} server(s) [${configMcpServers.map((s) => s.name).join(', ')}]`,
      );
      return tools;
    } catch (err) {
      Logger.error(
        `[createMainAgent] Config MCP servers failed to initialize`,
        err,
      );
      return [];
    }
  })();

  return configMcpToolsPromise;
}

// ---------------------------------------------------------------------------
// Main agent factory
// ---------------------------------------------------------------------------

export const createMainAgent = async ({
  state,
  config,
  ucanService,
  fileProcessingService,
  modelOverride,
  tasksService,
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

  // Derive user's Matrix ID from DID + homeserver for page invitations
  const userDid = configurable?.configs?.user?.did;
  const homeServer = configurable?.configs?.matrix?.homeServerName;
  const userMatrixId =
    userDid && homeServer
      ? `@${userDid.replace(/:/g, '-')}:${homeServer}`
      : undefined;
  const oracleOpenIdToken = configurable.configs?.user.matrixOpenIdToken
    ? await oracleOpenIdTokenProvider.getToken()
    : undefined;

  // Auth context (sandbox, memory, secrets, pageMemoryAuth)
  const auth = await buildAuthContext({
    userMatrixOpenIdToken: configurable.configs?.user.matrixOpenIdToken,
    oracleOpenIdToken,
    oracleMatrixBaseUrl,
    homeServerName: configurable.configs?.matrix.homeServerName,
    userDid,
    matrixRoomId: matrix?.roomId,
    ucanService,
    configService,
  });

  Logger.log(`msgFromMatrixRoom: ${msgFromMatrixRoom}`);

  // Time context
  const userConfig = configurable?.configs?.user;
  const timezone = userConfig?.timezone;
  const currentTime = userConfig?.currentTime;
  const timeContext = formatTimeContext(timezone, currentTime);

  if (!configurable?.configs?.user?.did) {
    throw new Error('User DID is required');
  }
  if (!configurable.thread_id) {
    throw new Error('Thread ID is required');
  }

  // AG-UI tools
  const agActionTools =
    state.agActions && state.agActions.length > 0
      ? state.agActions.map((action) => parserActionTool(action))
      : [];

  const aguiAgentSpec =
    agActionTools.length > 0
      ? createAguiAgent({
          tools: agActionTools,
          userDid: configurable.configs.user.did,
          sessionId: configurable.thread_id,
        })
      : null;

  // MCP tools (env-var-based)
  const getMcpTools = async () => createMCPClientAndGetTools();

  // Operational mode + editor section
  const taskExecCtx = (configurable as Record<string, unknown>)
    .taskExecutionContext as TaskExecutionContext | undefined;

  const { operationalMode, editorSection } = buildOperationalMode({
    taskExecutionContext: taskExecCtx,
    editorRoomId: state.editorRoomId,
    spaceId: state.spaceId,
    currentEntityDid: state.currentEntityDid,
  });

  // System prompt
  const systemPrompt = await buildSystemPrompt({
    oracleConfig,
    state,
    operationalMode,
    editorSection,
    timeContext,
    secretIndex: auth.secretIndex,
    oracleName:
      oracleConfig.oracleName || configService.get('ORACLE_NAME') || 'Oracle',
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

  // MCP tools agent for runtime MCP URLs (user-provided in chat)
  const mcpToolsAgentTool = createMcpToolsAgentTool({
    userDid: configurable.configs.user.did,
    sessionId: configurable.thread_id,
  });

  // Parallel initialization of all agents and tools
  const [
    portalResult,
    memoryResult,
    firecrawlResult,
    domainIndexerResult,
    mcpToolsResult,
    sandboxResult,
    taskManagerResult,
    configMcpToolsResult,
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
      userDid: configurable.configs.user.did,
      sessionId: configurable.thread_id,
    }),
    createMemoryAgent({
      headers: auth.memoryHeaders,
      mode: 'user',
      userDid: configurable.configs.user.did,
      sessionId: configurable.thread_id,
    }),
    createFirecrawlAgent({
      userDid: configurable.configs.user.did,
      sessionId: configurable.thread_id,
    }),
    createDomainIndexerAgent({
      userDid: configurable.configs.user.did,
      sessionId: configurable.thread_id,
    }),
    getMcpTools(),
    auth.sandboxMCP?.getTools() ?? Promise.resolve([]),
    matrix?.roomId && tasksService && userMatrixId
      ? createTaskManagerAgent({
          tasksService,
          mainRoomId: matrix.roomId,
          userDid: configurable.configs.user.did,
          matrixUserId: userMatrixId,
          sessionId: configurable.thread_id,
          timezone: timezone ?? 'UTC',
          spaceId: state.spaceId,
        })
      : Promise.resolve(null),
    getConfigMcpTools(),
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
  const configMcpTools = settled(
    configMcpToolsResult,
    [],
    'Config MCP servers',
  );
  const taskManagerAgent = settled(
    taskManagerResult,
    null,
    'Task Manager Agent',
  );

  // Wrap sandbox tools with lazy secret injection
  const wrappedSandboxTools = wrapSandboxToolsWithSecrets({
    sandboxTools,
    sandboxHeaders: auth.sandboxHeaders,
    secretIndex: auth.secretIndex,
    roomId: matrix?.roomId,
    configService,
  });

  // Conditionally create BlockNote (editor) agent tool if editorRoomId is provided
  let blockNoteAgentSpec:
    | Awaited<ReturnType<typeof createEditorAgent>>
    | undefined;
  if (state.editorRoomId) {
    Logger.log(`Editor room ID provided: ${state.editorRoomId}`);
    Logger.log('Initializing BlockNote tools...');
    try {
      blockNoteAgentSpec = await createEditorAgent({
        room: state.editorRoomId,
        mode: 'edit',
        userMatrixId,
        spaceId: state.spaceId,
        memoryAuth: auth.pageMemoryAuth,
        userDid: configurable.configs.user.did,
        sessionId: configurable.thread_id,
      });
    } catch (error) {
      Logger.error(
        `[createMainAgent] Editor Agent failed to initialize: ${String(error)}`,
      );
      unavailableServices.push('Editor Agent');
    }
  }

  // Helper to inject time context into sub-agent system prompts
  const withTimeContext = (spec: AgentSpec): AgentSpec => ({
    ...spec,
    systemPrompt: `${spec.systemPrompt}\n\n## Current Time\n${timeContext}`,
  });

  // Create standalone editor tool when spaceId is present but no editor session
  let standaloneEditorTool: StructuredTool | null = null;
  if (!state.editorRoomId && state.spaceId) {
    standaloneEditorTool = createStandaloneEditorTool({
      userMatrixId,
      spaceId: state.spaceId,
      memoryAuth: auth.pageMemoryAuth,
      transformSpec: withTimeContext,
      userDid: configurable.configs.user.did,
      sessionId: configurable.thread_id,
    });
    Logger.log(`Created standalone editor tool with spaceId: ${state.spaceId}`);
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
      Logger.log('Created apply_sandbox_output_to_block tool');
    }
  }

  // Sub-agent tools
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
  const callAguiAgentTool = aguiAgentSpec
    ? createSubagentAsTool(withTimeContext(aguiAgentSpec), {
        forwardTools: agActionTools.map((t) => t.name),
      })
    : null;
  const callEditorAgentTool = blockNoteAgentSpec
    ? createSubagentAsTool(withTimeContext(blockNoteAgentSpec), {
        forwardTools: [
          'create_page',
          'update_page',
          'edit_block',
          'create_block',
        ],
        onComplete: auth.pageMemoryAuth
          ? (messages, task) =>
              logEditorSessionToMemory(
                auth.pageMemoryAuth!,
                messages,
                state.editorRoomId!,
                task,
              )
          : undefined,
      })
    : null;
  const callTaskManagerAgentTool = taskManagerAgent
    ? createSubagentAsTool(withTimeContext(taskManagerAgent), {
        forwardTools: [
          'create_task',
          'list_tasks',
          'get_task_status',
          'set_approval_gate',
          'pause_task',
          'resume_task',
          'cancel_task',
          'update_task_schedule',
        ],
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

  // Ensure checkpointer DB folder exists
  const dbFolder = path.join(
    UserMatrixSqliteSyncService.checkpointsFolder,
    configurable?.configs?.user?.did,
  );
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }

  // Build middleware list conditionally
  const disableCredits = configService.get('DISABLE_CREDITS');
  const middleware = [
    createToolValidationMiddleware(),
    toolRetryMiddleware(),
    createPageContextMiddleware(),
  ];
  if (!disableCredits) {
    middleware.push(createTokenLimiterMiddleware());
  }

  const effectiveModel = modelOverride
    ? getProviderChatModel('main', { model: modelOverride })
    : llm;

  const agent = createAgent({
    model: effectiveModel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contextSchema: contextSchema as any,
    tools: [
      ...mcpTools,
      ...configMcpTools,
      ...wrappedSandboxTools,
      ...(callAguiAgentTool ? [callAguiAgentTool] : []),
      listSkillsTool,
      searchSkillsTool,
      ...(callPortalAgentTool ? [callPortalAgentTool] : []),
      ...(callMemoryAgentTool ? [callMemoryAgentTool] : []),
      ...(callFirecrawlAgentTool ? [callFirecrawlAgentTool] : []),
      ...(callDomainIndexerAgentTool ? [callDomainIndexerAgentTool] : []),
      ...(callEditorAgentTool ? [callEditorAgentTool] : []),
      ...(callTaskManagerAgentTool ? [callTaskManagerAgentTool] : []),
      ...(fileProcessingService
        ? [
            createFileProcessingTool(
              fileProcessingService,
              matrix?.roomId,
              auth.sandboxUploadConfig,
            ),
          ]
        : []),
      ...(matrix?.roomId ? [createListRoomFilesTool(matrix.roomId)] : []),
      ...(matrix?.roomId
        ? [createCheckSecretTool(matrix.roomId, configService.getOrThrow('ORACLE_ENTITY_DID'))]
        : []),
      ...(applySandboxOutputToBlockTool ? [applySandboxOutputToBlockTool] : []),
      ...(standaloneEditorTool ? [standaloneEditorTool] : []),
      ...(mcpToolsAgentTool ? [mcpToolsAgentTool] : []),
    ],
    middleware,
    stateSchema: z.object({
      editorRoomId: z.string().optional(),
    }),
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
