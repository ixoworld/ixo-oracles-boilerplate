import { getChatOpenAiModel } from '@ixo/common';
import { AIMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { Logger } from '@nestjs/common';
import { oracleConfig } from 'src/config';
import { z } from 'zod';
import { type TCustomerSupportGraphState } from '../../state';
import { tools } from '../tools-node';
import { chainOfThoughtPromptTemplate } from './prompt';

export const agentWithChainOfThoughtsNode = async (
  state: TCustomerSupportGraphState,
) => {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      await chainOfThoughtPromptTemplate.format({
        APP_NAME: oracleConfig.appName,
        APP_PURPOSE: oracleConfig.appPurpose,
        APP_MAIN_FEATURES: oracleConfig.appMainFeatures,
        APP_TARGET_USERS: oracleConfig.appTargetUsers,
        APP_UNIQUE_SELLING_POINTS: oracleConfig.appUniqueSellingPoints,
      }),
    ],
    new MessagesPlaceholder('messages'),
  ]);

  const chain = prompt.pipe(getChatOpenAiModel().bindTools(tools));
  const response = await chain.invoke({
    messages: state.messages,
  });
  const content = response.content.toString();

  if (response.tool_calls?.length === 0) {
    const llm = getChatOpenAiModel().withStructuredOutput(
      z.object({
        finalAnswer: z.string(),
      }),
    );
    const finalAnswer =
      extractAnswer(content) ??
      (
        await llm.invoke(
          `YOU ARE AN AI ASSISTANT. The following text is a response that includes a chain of thought process in a specific format with [CLARIFICATION], [SCRATCHPAD], [ANSWER], and [REFLECTION] sections.

EXTRACT ONLY the content inside the <answer> section, without including the <answer> label itself. If there is no clear <answer> section, provide a concise summary of the main points.

Your response should be in the same language as the original question and should be concise and to the point.

Here is the text to process:
${response.content.toString()}`,
        )
      ).finalAnswer;
    return {
      messages: [
        new AIMessage({
          content: finalAnswer,
          name: 'ChainOfThoughtAgent',
          additional_kwargs: {
            answer: true,
          },
        }),
      ],
    };
  }
  return {
    messages: [
      new AIMessage({
        ...response,
        name: 'ChainOfThoughtAgent',
        additional_kwargs: {
          ...response.additional_kwargs,
          answer: false,
        },
      }),
    ],
  };
};

function extractAnswer(documentText: string): string | null {
  // Pattern to match content between <answer> and </answer> tags
  const pattern = /<answer>(?<temp1>[\s\S]*?)<\/answer>/g;

  // Find all matches
  const matches = [...documentText.matchAll(pattern)];

  // Extract the content from the first match (index 1 contains the captured group)
  if (matches.length > 0) {
    Logger.log('✅ Pass extracting answer');
    return matches[0][1].trim();
  }
  Logger.log('❌ Failed extracting answer');
  return null;
}
