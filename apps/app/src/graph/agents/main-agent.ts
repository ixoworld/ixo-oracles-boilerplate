import { parserActionTool, parserBrowserTool } from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { OpenIdTokenProvider } from '@ixo/oracles-chain-client';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import {
  createAgent,
  toolRetryMiddleware,
  type ReactAgent,
  type StructuredTool,
} from 'langchain';
import { getConfig } from 'src/config';
import { type UcanService } from 'src/ucan/ucan.service';

import { createPageContextMiddleware } from '../middlewares/page-context-middleware';
import { createTokenLimiterMiddleware } from '../middlewares/token-limiter-middelware';
import { createToolValidationMiddleware } from '../middlewares/tool-validation-middleware';
import {
  AI_ASSISTANT_PROMPT,
  SLACK_FORMATTING_CONSTRAINTS_CONTENT,
} from '../nodes/chat-node/prompt';
import { type TMainAgentGraphState } from '../state';
import { contextSchema } from '../types';
import { createDomainIndexerAgent } from './domain-indexer-agent';
import { createApplySandboxOutputToBlockTool } from './editor/apply-sandbox-output-to-block';
import { createEditorAgent } from './editor/editor-agent';
import {
  logEditorSessionToMemory,
  type PageMemoryAuth,
} from './editor/page-memory';
import {
  EDITOR_MODE_PROMPTS,
  STANDALONE_EDITOR_PROMPTS,
} from './editor/prompts';
import { createStandaloneEditorTool } from './editor/standalone-editor-tool';
import { createFirecrawlAgent } from './firecrawl-agent';
import { createMemoryAgent } from './memory-agent';
import { createAguiAgent } from './agui-agent';
import { createPortalAgent } from './portal-agent';
import { createSubagentAsTool, type AgentSpec } from './subagent-as-tool';
import { createTaskManagerAgent } from './task-manager';

import { DynamicStructuredTool } from 'langchain';
import fs from 'node:fs';
import path from 'node:path';
import {
  type FileProcessingService,
  type SandboxUploadConfig,
} from 'src/messages/file-processing.service';
import { SecretsService } from 'src/secrets/secrets.service';
import type { TaskExecutionContext } from 'src/tasks/processors/processor-utils';
import { type TasksService } from 'src/tasks/task.service';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import z from 'zod';
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

/**
 * Convert a memory engine SearchEnhancedResponse into clean markdown.
 * Extracts only the meaningful content (facts + entity names) and drops
 * internal metadata (strategy_used, query, UUIDs, total_results).
 *
 * Accepts unknown to avoid coupling to the SearchEnhancedResponse type
 * while safely extracting the fields that exist at runtime.
 */
function formatUserContext(data: unknown): string {
  if (!data || typeof data !== 'object') return '_No information available._';

  const obj = data as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return '_No information available._';

  const lines: string[] = [];

  // Extract facts — array of { fact: string, ... }
  const facts = Array.isArray(obj.facts) ? obj.facts : [];
  for (const f of facts) {
    const fact =
      typeof f === 'object' && f !== null && 'fact' in f
        ? String(f.fact)
        : null;
    if (fact) lines.push(`- ${fact}`);
  }

  // Extract entity names — array of { name: string, ... }
  const entities = Array.isArray(obj.entities) ? obj.entities : [];
  const names = entities
    .map((e) =>
      typeof e === 'object' && e !== null && 'name' in e
        ? String(e.name)
        : null,
    )
    .filter(Boolean);
  if (names.length > 0) lines.push(`- **Related:** ${names.join(', ')}`);

  return lines.length > 0 ? lines.join('\n') : '_No information available._';
}

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

  // Build AG-UI sub-agent when actions are available
  const aguiAgentSpec =
    agActionTools.length > 0
      ? createAguiAgent({
          tools: agActionTools,
          userDid: configurable.configs.user.did,
          sessionId: configurable.thread_id,
        })
      : null;

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

  // Build operational mode + editor section via JS — cleaner than nested mustache conditionals
  const editorPrompts = state.editorRoomId
    ? EDITOR_MODE_PROMPTS
    : state.spaceId
      ? STANDALONE_EDITOR_PROMPTS
      : null;

  const taskExecCtx = (configurable as Record<string, unknown>)
    .taskExecutionContext as TaskExecutionContext | undefined;

  const operationalMode = taskExecCtx
    ? [
        `**Autonomous Task Execution Mode**`,
        ``,
        `You are running a scheduled task autonomously — no human is in the loop. The user message contains a Task Page that is your **complete blueprint**. You MUST follow this exact 2-step sequence:`,
        ``,
        `## Step 1: Execute the Task`,
        `- Follow the Task Page exactly — execute "What to Do", format per "How to Report", obey "Constraints".`,
        `- If a step fails, check "Notes" for fallbacks before improvising. If the page is missing critical sections, report failure instead of guessing.`,
        `- Do not ask questions or narrate. Deliver only the requested output.`,
        ``,
        `### Tool Preferences`,
        `- **Fetching data / API calls**: Prefer the AI Sandbox (code execution) for HTTP requests, JSON parsing, and data processing.`,
        `- **Web scraping**: Use the Firecrawl Agent for scraping web pages and extracting content.`,
        `- **Simple searches**: Use the Firecrawl Agent's search tool for quick web searches.`,
        `- **Memory**: Use the Memory Agent to recall prior knowledge before external lookups.`,
        ``,
        `## Step 2: Execution Report (REQUIRED)`,
        `After producing your output, you MUST review your execution before finishing:`,
        ``,
        `1. **Task Page Notes** — Use the editor to append to "Notes" under "### Run #${taskExecCtx.runNumber} Learnings":`,
        `   - If issues occurred (API failures, retries, fallbacks, unexpected data): document each one concisely.`,
        `   - If everything was smooth: write "No issues encountered."`,
        `   Do NOT overwrite existing notes.`,
        `2. **Memory Engine** — Use the Memory Agent to store any cross-task learnings that could benefit future tasks (e.g., "API X rate-limits at 10 req/min", "Website Y needs JS rendering").`,
      ].join('\n')
    : editorPrompts
      ? editorPrompts.operationalMode
      : state.currentEntityDid
        ? [
            `**Entity Context Active**`,
            ``,
            `You are currently viewing an entity (DID: ${state.currentEntityDid}). Use:`,
            `- **Domain Indexer Agent** for entity discovery, overviews, and FAQs`,
            `- **Portal Agent** for navigation or UI actions (e.g., \`showEntity\`)`,
            `- **Memory Agent** for historical knowledge`,
            `For entities like ecs, supamoto, ixo, QI, use both Domain Indexer and Memory Agent together.`,
            ``,
            `**Important:** Pages (BlockNote documents) are NOT entities. For pages, use \`list_workspace_pages\` and \`call_editor_agent\` — never the Domain Indexer.`,
          ].join('\n')
        : [
            `**General Conversation Mode**`,
            ``,
            `Default to conversation mode, using the Memory Agent for recall and the Firecrawl Agent for external research or fresh data.`,
            ``,
            `### Tool Preferences`,
            `- **Fetching data / API calls**: Prefer the AI Sandbox for HTTP requests, JSON parsing, and data processing.`,
            `- **Web scraping**: Use the Firecrawl Agent for scraping and content extraction.`,
            `- **Simple searches**: Use the Firecrawl Agent's search tool.`,
            ``,
            `### Task Trial Runs`,
            `When the Task Manager asks you to do a trial run for a scheduled task, you are testing the work so the user can approve it. After completing the work:`,
            `1. Show the user the result as requested.`,
            `2. **Report your execution trace** — list every agent, URL, API endpoint (with params), search query, skill (name + CID), and the step-by-step order. Mention any failures or fallbacks.`,
            `This trace is critical — the Task Manager uses it to write a detailed task page for autonomous runs.`,
          ].join('\n');

  const editorSection = editorPrompts?.editorSection ?? '';

  // System prompt is critical — failure here is a code bug, not a transient issue
  const systemPrompt = await AI_ASSISTANT_PROMPT.format({
    APP_NAME:
      oracleConfig.oracleName || configService.get('ORACLE_NAME') || 'Oracle',
    ORACLE_CONTEXT: buildOracleContext(oracleConfig),
    IDENTITY_CONTEXT: formatUserContext(state?.userContext?.identity),
    WORK_CONTEXT: formatUserContext(state?.userContext?.work),
    GOALS_CONTEXT: formatUserContext(state?.userContext?.goals),
    INTERESTS_CONTEXT: formatUserContext(state?.userContext?.interests),
    RELATIONSHIPS_CONTEXT: formatUserContext(state?.userContext?.relationships),
    RECENT_CONTEXT: formatUserContext(state?.userContext?.recent),
    TIME_CONTEXT: timeContext,
    CURRENT_ENTITY_DID: state.currentEntityDid ?? '',
    OPERATIONAL_MODE: operationalMode,
    EDITOR_SECTION: editorSection,
    SLACK_FORMATTING_CONSTRAINTS:
      state.client === 'slack' ? SLACK_FORMATTING_CONSTRAINTS_CONTENT : '',
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
    taskManagerResult,
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
      oracleToken: oracleOpenIdToken ?? '',
      userToken: configurable.configs?.user.matrixOpenIdToken ?? '',
      oracleHomeServer: oracleMatrixBaseUrl.replace(/^https?:\/\//, ''),
      userHomeServer: configurable.configs?.matrix.homeServerName ?? '',
      roomId: matrix?.roomId ?? '',
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
    sandboxMCP?.getTools() ?? Promise.resolve([]),
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
  const taskManagerAgent = settled(
    taskManagerResult,
    null,
    'Task Manager Agent',
  );

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

    try {
      blockNoteAgentSpec = await createEditorAgent({
        room: state.editorRoomId,
        mode: 'edit',
        userMatrixId,
        spaceId: state.spaceId,
        memoryAuth: pageMemoryAuth,
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

  // Create standalone editor tool when spaceId is present but no editor session.
  // Accepts a room_id per call, spinning up an ephemeral editor agent with full
  // BlockNote capabilities for that page.
  let standaloneEditorTool: StructuredTool | null = null;
  if (!state.editorRoomId && state.spaceId) {
    const userDid = configurable?.configs?.user?.did;
    const homeServer = configurable?.configs?.matrix?.homeServerName;
    const standaloneUserMatrixId =
      userDid && homeServer
        ? `@${userDid.replace(/:/g, '-')}:${homeServer}`
        : undefined;

    standaloneEditorTool = createStandaloneEditorTool({
      userMatrixId: standaloneUserMatrixId,
      spaceId: state.spaceId,
      memoryAuth: pageMemoryAuth,
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
      Logger.log('📦 Created apply_sandbox_output_to_block tool');
    }
  }

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
        onComplete: pageMemoryAuth
          ? (messages, task) =>
              logEditorSessionToMemory(
                pageMemoryAuth,
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
              sandboxUploadConfig,
            ),
          ]
        : []),
      ...(matrix?.roomId ? [createListRoomFilesTool(matrix.roomId)] : []),
      ...(applySandboxOutputToBlockTool ? [applySandboxOutputToBlockTool] : []),
      ...(standaloneEditorTool ? [standaloneEditorTool] : []),
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
