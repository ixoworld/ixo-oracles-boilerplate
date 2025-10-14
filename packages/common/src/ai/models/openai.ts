import 'dotenv/config';

import {
  ChatOpenAI,
  OpenAIEmbeddings,
  type ChatOpenAIFields,
  type ChatOpenAIResponseFormat,
} from '@langchain/openai';
import OpenAI, { type ClientOptions } from 'openai';

const getChatOpenAiModel = (params?: ChatOpenAIFields): ChatOpenAI =>
  new ChatOpenAI({
    temperature: 0.2,
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    ...params,
  });

const getOpenAiClient = (params?: ClientOptions): OpenAI =>
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...params,
  });

const getOpenAiEmbeddings = (
  params?: ConstructorParameters<typeof OpenAIEmbeddings>[0],
): OpenAIEmbeddings =>
  new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
    ...params,
  });

export const getOpenRouterChatModel = (params?: ChatOpenAIFields) =>
  getChatOpenAiModel({
    temperature: 0.8,
    apiKey: process.env.OPEN_ROUTER_API_KEY,
    model: params?.model ?? 'qwen/qwen3-14b', //qwen3-30b-a3b
    ...params,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      ...params?.configuration,
      defaultHeaders: {
        'HTTP-Referer': 'oracle-app.com',
        'X-Title': process.env.ORACLE_NAME ?? 'Oracle App',
      },
    },
    modelKwargs: {
      require_parameters: true,
      ...params?.modelKwargs,
    },
  });
export { getChatOpenAiModel, getOpenAiClient, getOpenAiEmbeddings };
export type { ChatOpenAIResponseFormat };
