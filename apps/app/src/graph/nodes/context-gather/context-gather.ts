import { getOpenAiClient, jsonToYaml, zodResponseFormat } from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import { Logger } from '@nestjs/common';
// import { OpenAI } from 'openai';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { queryMemories } from '../tools-node/matrix-memory';
import { UserContextSchema } from './type';

// const openAI = getOpenAiClient({})

export const contextGatherNode = async (
  state: TCustomerSupportGraphState,
  config: RunnableConfig,
): Promise<Partial<TCustomerSupportGraphState>> => {
  if (state.userContext.name && state.userContext.recentSummary) {
    Logger.log('User context already exists, skipping context gather');
    return {
      userContext: state.userContext,
    };
  }
  const memorySearchResults = await queryMemories({
    query: 'user overview and communication style and habits',
    strategy: 'precise',
    roomId:
      (config as IRunnableConfigWithRequiredFields).configurable.configs?.matrix
        .roomId ?? '',
    userDid:
      (config as IRunnableConfigWithRequiredFields).configurable.configs?.user
        .did ?? '',
  });

  const llm = getOpenAiClient({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPEN_ROUTER_API_KEY,
  });

  const prompt = await ChatPromptTemplate.fromMessages(
    [
      [
        'system',
        `You are a memory summarizer assistant. Your task is to analyze the memory search results from a single query (e.g. "user overview"), and generate a compact user summary for a larger agent to consume.
    Extract the following if available:
    - The user's preferred name or nickname
    - Their communication style (e.g. casual, detailed, formal, fast-paced)
    - A brief summary of recent events or updates in their life (e.g. projects, feelings, decisions)
    Be concise, friendly, and informative. If a field is unknown, return null and don't guess.


    Make your summary will written and detailed so the second Agent can use it to understand the user and the user's context. and it must include Dates for the recent events and the summary so we get time context also
    FYI current date is ${new Date().toLocaleString()}

      Make sure to return the result in the following format:
      {
        "name": "string",
        "communicationStyle": "string",
        "recentSummary": "string",
        "extraInfo": "string"
      }
    `,
      ],
      [
        'user',
        `Here is the memory search results:
     ${jsonToYaml(memorySearchResults)}
    `,
      ],
    ],
    {
      templateFormat: 'mustache',
    },
  ).format({});

  const result = await llm.beta.chat.completions.parse({
    model: 'meta-llama/llama-3.1-8b-instruct',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    response_format: zodResponseFormat(UserContextSchema, 'userContext'),
  });

  const parsedResult = result.choices.at(0)?.message.parsed;

  if (!parsedResult) {
    throw new Error('Failed to gather context');
  }
  return {
    userContext: parsedResult,
  };
};
