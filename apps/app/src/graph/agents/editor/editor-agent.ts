import { getOpenRouterChatModel } from '@ixo/common';
import { type StructuredTool } from 'langchain';

import type { AgentSpec } from '../subagent-as-tool';
import {
  BLOCKNOTE_TOOLS_CONFIG,
  createBlocknoteTools,
} from './blocknote-tools';
import type { AppConfig, MatrixRoomConfig } from './config';
import { EditorMatrixClient } from './editor-mx';
import { editorAgentPrompt, editorAgentReadOnlyPrompt } from './prompts';
import { Logger } from '@nestjs/common';

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

const normalizeRoom = (room: string | MatrixRoomConfig): MatrixRoomConfig => {
  if (typeof room === 'string') {
    return { type: 'id', value: room };
  }
  return room;
};

type AppConfigOverrides = {
  matrix?: Partial<AppConfig['matrix']>;
  provider?: Partial<AppConfig['provider']>;
  blocknote?: Partial<AppConfig['blocknote']>;
};

const buildAppConfig = (
  room: MatrixRoomConfig,
  overrides?: AppConfigOverrides,
): AppConfig => {
  const base: AppConfig = {
    matrix: {
      ...BLOCKNOTE_TOOLS_CONFIG.matrix,
      room,
    },
    provider: {
      ...BLOCKNOTE_TOOLS_CONFIG.provider,
    },
    blocknote: {
      ...BLOCKNOTE_TOOLS_CONFIG.blocknote,
    },
  };

  if (!overrides) {
    return base;
  }

  return {
    matrix: {
      ...base.matrix,
      ...overrides.matrix,
      room: overrides.matrix?.room ?? base.matrix.room,
    },
    provider: {
      ...base.provider,
      ...overrides.provider,
    },
    blocknote: {
      ...base.blocknote,
      ...overrides.blocknote,
    },
  };
};

type BlocknoteToolset =
  | {
      listBlocksTool: StructuredTool;
      readBlockByIdTool: StructuredTool;
    }
  | {
      listBlocksTool: StructuredTool;
      editBlockTool: StructuredTool;
      createBlockTool: StructuredTool;
    readBlockByIdTool: StructuredTool;
    readSurveyTool: StructuredTool;
    fillSurveyAnswersTool: StructuredTool;
    validateSurveyAnswersTool: StructuredTool;
    };

export type EditorAgentMode = 'edit' | 'readOnly';

export type EditorAgentInstance = AgentSpec;

export interface CreateEditorAgentParams {
  room: string | MatrixRoomConfig;
  mode?: EditorAgentMode;
  configOverrides?: AppConfigOverrides;
  name?: string;
  description?: string;
}

const resolveTools = (
  mode: EditorAgentMode,
  toolset: BlocknoteToolset,
): StructuredTool[] => {
  if (mode === 'readOnly') {
    return [toolset.listBlocksTool, toolset.readBlockByIdTool];
  }

  const writableToolset = toolset as Extract<
    BlocknoteToolset,
    {
      listBlocksTool: StructuredTool;
      editBlockTool: StructuredTool;
      createBlockTool: StructuredTool;
      readBlockByIdTool: StructuredTool;
      readSurveyTool: StructuredTool;
      fillSurveyAnswersTool: StructuredTool;
      validateSurveyAnswersTool: StructuredTool;
    }
  >;

  if (!writableToolset.editBlockTool || !writableToolset.createBlockTool) {
    throw new Error('Writable editor mode requires edit and create tools.');
  }

  return [
    writableToolset.listBlocksTool,
    writableToolset.editBlockTool,
    writableToolset.createBlockTool,
    writableToolset.readBlockByIdTool,
    writableToolset.readSurveyTool,
    writableToolset.fillSurveyAnswersTool,
    writableToolset.validateSurveyAnswersTool,
  ];
};

export const createEditorAgent = async ({
  room,
  mode = 'edit',
  configOverrides,
  name = 'Editor Agent',
  description = 'AI Agent that read and write to pages and editor.',
}: CreateEditorAgentParams): Promise<EditorAgentInstance> => {
  const roomConfig = normalizeRoom(room);
  const editorMatrixClient = EditorMatrixClient.getInstance();
  await editorMatrixClient.waitUntilReady();
  const matrixClient = editorMatrixClient.getClient();

  const appConfig = buildAppConfig(roomConfig, configOverrides);

  const blocknoteTools = (await createBlocknoteTools(
    matrixClient,
    appConfig,
    mode === 'readOnly',
  )) as BlocknoteToolset;

  const agentTools = resolveTools(mode, blocknoteTools);

  Logger.log(`Created editor agent with Mode: ${mode}`);
  Logger.log(`Tools: ${agentTools.map((t) => t.name).join(', ')}`);
  return {
    name,
    description,
    tools: agentTools,
    systemPrompt:
      mode === 'readOnly' ? editorAgentReadOnlyPrompt : editorAgentPrompt,
    model: llm,
    middleware: [],
  };
};
