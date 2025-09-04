import { getOpenRouterChatModel, jsonToYaml } from '@ixo/common';
import {
  MatrixManager,
  type IRunnableConfigWithRequiredFields,
} from '@ixo/matrix';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { type RunnableConfig } from '@langchain/core/runnables';
import { Logger } from '@nestjs/common';
// import { OpenAI } from 'openai';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { queryMemories } from '../tools-node/matrix-memory';
import { UserContextSchema } from './type';

// const openAI = getOpenAiClient({})

const matrixManager = MatrixManager.getInstance();

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

  const userDid = (config as IRunnableConfigWithRequiredFields).configurable
    .configs?.user.did;

  if (!userDid) {
    throw new Error('User DID is required for context gathering');
  }

  const userDisplayName = await getUserDisplayName(userDid);

  const memorySearchResults = await queryMemories({
    query: 'user overview and communication style and habits',
    strategy: 'precise',
    roomId:
      (config as IRunnableConfigWithRequiredFields).configurable.configs?.matrix
        .roomId ?? '',
    userDid,
    oracleDid:
      (config as IRunnableConfigWithRequiredFields).configurable.configs?.matrix
        .oracleDid ?? '',
  });

  const llm = getOpenRouterChatModel({
    model: 'mistralai/ministral-3b',
  });

  const prompt = ChatPromptTemplate.fromMessages(
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

      Also this is the user's display name in matrix you can use it as fallback if the name is not found in the memory search results but of course if it is valid name not a did or random uuid it should be a real name
      ${userDisplayName}
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
  );

  const chain = prompt.pipe(llm.withStructuredOutput(UserContextSchema));

  const parsedResult = await chain.invoke(null);

  if (!parsedResult) {
    throw new Error('Failed to gather context');
  }
  return {
    userContext: parsedResult,
  };
};

const getUserDisplayName = async (userDid: string) => {
  try {
    // Get the Matrix base URL from environment and extract the hostname
    const matrixBaseUrl = process.env.MATRIX_BASE_URL;
    if (!matrixBaseUrl) {
      throw new Error('MATRIX_BASE_URL environment variable is required');
    }

    const homeserverName = new URL(matrixBaseUrl).hostname;
    // Format the DID by replacing colons with hyphens for Matrix username
    const formattedUserDid = userDid.replace(/:/g, '-');
    const userId = `@${formattedUserDid}:${homeserverName}`;

    const userDisplayName = await matrixManager.getDisplayName(userId);
    return userDisplayName;
  } catch (error) {
    return null;
  }
};
