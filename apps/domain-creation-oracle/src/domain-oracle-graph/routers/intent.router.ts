import { createSemanticRouter } from '@ixo/common';
import { Logger } from '@ixo/logger';
import { RunnableConfig } from '@langchain/core/runnables';
import { DomainCreationOracleState } from '../state.js';
import { GraphNodes } from '../types.js';

const routes = {
  [GraphNodes.DomainCreationOracle]:
    'Route for handling all domain-related operations and questions. Choose this route if the messages involve anything about domains/entities, including creation, setup, management, configuration, or general questions and inquiries about domains. This includes users asking about domain features, capabilities, use cases, or technical details, even if they are not explicitly creating a domain yet. Any technical or informational request related to domains, projects, DAOs, oracles, protocols, collections, assets, or deeds should go through this route. \n You should use "messages" to get the last message from the user and assets to determine the next step. Domain terminology note: domain == entity, project == entity, and related concepts include DAO, oracle, investment, protocol, collection, asset, deed.',
  [GraphNodes.GenericChat]:
    'Route exclusively for general conversation and chitchat unrelated to domains or technical questions. Choose this route ONLY for general greetings, small talk, personal conversations, or topics completely unrelated to domains/entities and their technical aspects. If the user asks anything substantive about domains or related concepts, even just questions about what domains are or how they work, use the DomainCreationOracle route instead.\n You should use "messages" to get the last message from the user to determine if this is truly just casual conversation.',
};

export const intentRouter = async (
  state: DomainCreationOracleState,
  _RunnableConfig?: RunnableConfig,
) => {
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
  Logger.info(`🚀 ~ Next route: ${nextRoute}`);
  return nextRoute;
};
