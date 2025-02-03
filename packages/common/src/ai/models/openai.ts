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
    cache: true,
    temperature: 0.2,
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    ...params,
  });

const getRawOpenAiModel = (params?: ClientOptions): OpenAI =>
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
export { getChatOpenAiModel, getOpenAiEmbeddings, getRawOpenAiModel };
export type { ChatOpenAIResponseFormat };
