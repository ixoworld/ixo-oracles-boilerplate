import {
  getOpenRouterChatModel,
  parserActionTool,
  parserBrowserTool,
  SearchEnhancedResponse,
} from '@ixo/common';
import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { Logger } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
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
import { createEditorAgent, EditorAgentInstance } from './editor/editor-agent';
import { EDITOR_DOCUMENTATION_CONTENT_READ_ONLY } from './editor/prompts';
import { createFirecrawlAgent } from './firecrawl-agent';
import { createMemoryAgent } from './memory-agent';
import { createPortalAgent } from './portal-agent';
interface InvokeMainAgentParams {
  state: Partial<TMainAgentGraphState>;
  config: IRunnableConfigWithRequiredFields;
}

import fs from 'node:fs';
import path from 'node:path';
import { UserMatrixSqliteSyncService } from 'src/user-matrix-sqlite-sync-service/user-matrix-sqlite-sync-service.service';
import { createMCPClientAndGetTools } from '../mcp';

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

export const createMainAgent = async ({
  state,
  config,
}: InvokeMainAgentParams) => {
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

  const [
    systemPrompt,
    portalAgent,
    memoryAgent,
    firecrawlAgent,
    domainIndexerAgent,
    mcpTools,
  ] = await Promise.all([
    AI_ASSISTANT_PROMPT.format({
      APP_NAME: 'IXO | IXO Portal',
      IDENTITY_CONTEXT: formatContextData(state.userContext?.identity),
      WORK_CONTEXT: formatContextData(state.userContext?.work),
      GOALS_CONTEXT: formatContextData(state.userContext?.goals),
      INTERESTS_CONTEXT: formatContextData(state.userContext?.interests),
      RELATIONSHIPS_CONTEXT: formatContextData(
        state.userContext?.relationships,
      ),
      RECENT_CONTEXT: formatContextData(state.userContext?.recent),
      TIME_CONTEXT: timeContext,
      EDITOR_DOCUMENTATION: state.editorRoomId
        ? EDITOR_DOCUMENTATION_CONTENT_READ_ONLY
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
    createMCPClientAndGetTools(),
  ]);

  // Conditionally create BlockNote tools if editorRoomId is provided
  let blockNoteAgent: EditorAgentInstance | undefined = undefined;
  if (state.editorRoomId) {
    Logger.log(`📝 Editor room ID provided: ${state.editorRoomId}`);
    Logger.log('🔧 Initializing BlockNote tools...');

    blockNoteAgent = await createEditorAgent({
      room: state.editorRoomId,
      mode: 'readOnly',
    });
  }

  const agents = [portalAgent, domainIndexerAgent, memoryAgent, firecrawlAgent];
  if (blockNoteAgent) {
    agents.push(blockNoteAgent);
  }

  // check db folder if not exists, create it
  const dbFolder = path.join(
    UserMatrixSqliteSyncService.checkpointsFolder,
    configurable?.configs?.user?.did,
  );
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }

  const agent = createDeepAgent({
    model: llm,
    subagents: agents,
    contextSchema,
    tools: [...mcpTools, ...agActionTools],
    middleware: [
      createToolValidationMiddleware(),
      createSafetyGuardrailMiddleware(),
      createTokenLimiterMiddleware(),
    ],
    systemPrompt,
    checkpointer: SqliteSaver.fromConnString(
      UserMatrixSqliteSyncService.getUserCheckpointDbPath(
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
