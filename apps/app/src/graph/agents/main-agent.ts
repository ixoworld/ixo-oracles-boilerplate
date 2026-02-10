import {
  getOpenRouterChatModel,
  jsonToYaml,
  parserActionTool,
  parserBrowserTool,
  SearchEnhancedResponse,
} from '@ixo/common';
import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAgent, ReactAgent, toolRetryMiddleware } from 'langchain';
import { ENV } from 'src/config';
import { UcanService } from 'src/ucan/ucan.service';
import { createSafetyGuardrailMiddleware } from '../middlewares/safety-guardrail-middleware';
import { createTokenLimiterMiddleware } from '../middlewares/token-limiter-middelware';
import { createToolValidationMiddleware } from '../middlewares/tool-validation-middleware';
import {
  AG_UI_TOOLS_DOCUMENTATION,
  AI_ASSISTANT_PROMPT,
  SLACK_FORMATTING_CONSTRAINTS_CONTENT,
} from '../nodes/chat-node/prompt';
import { TMainAgentGraphState } from '../state';
import { contextSchema } from '../types';
import { createDomainIndexerAgent } from './domain-indexer-agent';
import { createEditorAgent } from './editor/editor-agent';
import { EDITOR_DOCUMENTATION_CONTENT } from './editor/prompts';
import { createFirecrawlAgent } from './firecrawl-agent';
import { createMemoryAgent } from './memory-agent';
import { createPortalAgent } from './portal-agent';
import { createSubagentAsTool } from './subagent-as-tool';

import fs from 'node:fs';
import path from 'node:path';
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
import { presentFilesTool } from './skills-agent/present-files-tool';

interface InvokeMainAgentParams {
  state: Partial<TMainAgentGraphState>;
  config: IRunnableConfigWithRequiredFields;
  /** Optional UCAN service for MCP tool authorization */
  ucanService?: UcanService;
}

const llm = getOpenRouterChatModel({
  model: 'openai/gpt-oss-120b:nitro',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});
const sandboxMCP = createMCPClient({
  mcpServers: {
    sandbox: {
      type: 'http',
      url: 'http://localhost:8787/mcp',
      transport: 'http',
      headers: {
        Authorization: `Bearer ${process.env.SANDBOX_API_KEY}`,
      },
    },
  },
});
export const createMainAgent = async ({
  state,
  config,
  ucanService,
}: InvokeMainAgentParams): Promise<ReactAgent<any, any, any, any>> => {
  const msgFromMatrixRoom = Boolean(
    state.messages?.at(-1)?.additional_kwargs.msgFromMatrixRoom,
  );

  const { configurable } = config as IRunnableConfigWithRequiredFields;
  const { matrix } = configurable?.configs ?? {};
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
      userDid: configurable?.configs?.user?.did,
      oracleDid: matrix?.oracleDid ?? '',
      roomId: matrix?.roomId ?? '',
      mode: 'user',
    }),
    createFirecrawlAgent(),
    createDomainIndexerAgent(),
    getMcpTools(),
    sandboxMCP?.getTools() ?? Promise.resolve([]),
  ]);

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
  const configService = new ConfigService<ENV>();
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
    contextSchema: contextSchema as any,
    tools: [
      ...mcpTools,
      ...sandboxTools,
      ...agActionTools,
      presentFilesTool,
      listSkillsTool,
      searchSkillsTool,
      callPortalAgentTool,
      callMemoryAgentTool,
      callFirecrawlAgentTool,
      callDomainIndexerAgentTool,
      ...(callEditorAgentTool ? [callEditorAgentTool] : []),
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
const formatContextData = (data: SearchEnhancedResponse | undefined) => {
  if (!data) return 'No specific information available.';

  let context = '';

  if (data.facts && data.facts.length > 0) {
    context += '**Key Facts:**\n';
    data.facts.slice(0, 3).forEach((fact: any) => {
      context += `- ${fact.fact}\n`;
    });
  }

  if (data.entities && data.entities.length > 0) {
    context += '\n**Relevant Entities:**\n';
    data.entities.slice(0, 3).forEach((entity: any) => {
      context += `- ${entity.name}: ${entity.summary}\n`;
    });
  }

  if (data.episodes && data.episodes.length > 0) {
    context += '\n**Recent Episodes:**\n';
    data.episodes.slice(0, 2).forEach((episode: any) => {
      context += `- ${episode.name}: ${episode.content.substring(0, 100)}...\n`;
    });
  }

  return context || 'No specific information available.';
};
