import { getChatOpenAiModel } from '@ixo/common';
import { AIMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Command, END } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { GraphNodes } from 'src/graph/types';
import { z } from 'zod';
import { evaluationPrompt } from './prompt';

export const evaluationNode = async (state: TCustomerSupportGraphState) => {
  const userQuestion = state.messages
    .findLast((m) => m.getType() === 'human')
    ?.content.toString();
  const agentAnswer = state.messages
    .findLast(
      (m) =>
        m.getType() === 'ai' &&
        m.additional_kwargs.answer === true &&
        m.name === 'ChainOfThoughtAgent',
    )
    ?.content.toString();

  const prompt = ChatPromptTemplate.fromMessages(
    [
      [
        'system',
        await evaluationPrompt.format({
          USER_QUESTION: userQuestion,
          AGENT_ANSWER: agentAnswer,
          CHAT_HISTORY: state.messages
            .map(
              (m) =>
                `${
                  m.getType() === 'human' ? 'User' : `Agent(${m.name})`
                }: ${m.content.toString()}`,
            )
            .join('\n'),
        }),
      ],
    ],
    {
      templateFormat: 'mustache',
    },
  );
  const chain = prompt.pipe(
    getChatOpenAiModel().withStructuredOutput(
      z.object({
        understanding: z.enum(['Yes', 'No']),
        reason: z.string(),
        feedback: z.string(),
      }),
    ),
  );

  Logger.log(userQuestion, 'userQuestion');
  Logger.log(agentAnswer, 'agentAnswer');
  const results = await chain.invoke(null);

  if (results.understanding === 'No') {
    Logger.log(results, 'results');
    return new Command({
      goto: GraphNodes.AgentWithChainOfThoughts,
      update: {
        messages: [
          new AIMessage({
            content: `I am your supervisor. I have reviewed your answer and rejected it. Here is the feedback: ${results.feedback} and why: ${results.reason}`,
            name: 'EvaluationAgent',
          }),
        ],
      },
    });
  }
  return new Command({
    goto: END,
  });
};
