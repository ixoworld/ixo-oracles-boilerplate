import { createSemanticRouter } from '@ixo/common';
import { type RunnableConfig } from '@langchain/core/runnables';
import { END } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { type TCustomerSupportGraphState } from '../state';
import { GraphNodes } from '../types';

const routes = {
  [GraphNodes.Chat]:
    'Route exclusively for general conversation and chitchat \n You should use "messages" to get the last message from the user to determine what the user wants to do.',
  [GraphNodes.AgentWithChainOfThoughts]:
    'Route exclusively for complex tasks or for questions that are not general conversation and chitchat. you should use "messages" to get the last message from the user to determine what the user wants to do.',
  [END]:
    'Route to end the conversion if the user replied with a convo closer like "bye" or "goodbye" or "thank you" or "thank you for your help", You should use "messages" to get the last message from the user to determine what the user wants to do.',
};

export const intentRouter = async (
  state: TCustomerSupportGraphState,
  _RunnableConfig?: RunnableConfig,
): Promise<GraphNodes> => {
  const simplifiedState = {
    messages: state.messages.reduce<{ sender: string; content: string }[]>(
      (acc, message) => {
        if (message.getType() !== 'system') {
          acc.push({
            sender: message.getType(),
            content: message.content.toString(),
          });
        }
        return acc;
      },
      [],
    ),
  };

  const getNextRoute = createSemanticRouter(
    routes,
    Object.keys(simplifiedState),
    'gpt-4o-mini',
  );

  const nextRoute = await getNextRoute(simplifiedState);
  Logger.log(`🚀 ~ Next route: ${nextRoute}`);
  return nextRoute as GraphNodes;
};
