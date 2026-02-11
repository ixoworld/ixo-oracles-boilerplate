import { Logger } from '@nestjs/common';
import { AgentMiddleware, AIMessageChunk, createMiddleware } from 'langchain';
import { TokenLimiter, TokenLimiterError } from 'src/utils/token-limit-handler';
import { contextSchema, TChatNodeContext } from '../types';

const createTokenLimiterMiddleware = (): AgentMiddleware => {
  return createMiddleware({
    name: 'TokenLimiterMiddleware',
    contextSchema,
    beforeModel: async (state, runtime) => {
      if (!runtime.context) {
        throw new Error('Runtime context required for token limiting');
      }

      const { userDid } = runtime.context as TChatNodeContext;
      if (!userDid) {
        throw new Error('User DID is required for token management');
      }

      Logger.debug(`Checking token balance for user ${userDid}`);

      const remaining = await TokenLimiter.getRemaining(userDid);

      Logger.debug(`Remaining tokens: ${remaining} for user ${userDid}`);

      if (remaining <= 0) {
        return {
          ...state,
          messages: [
            ...state.messages,
            new AIMessageChunk({
              content: `Looks like you have run out of tokens. Please upgrade your plan or topup your balance. You have ${remaining} tokens remaining.`,
            }),
          ],
        };
      }

      return state;
    },

    afterModel: async (state, runtime) => {
      try {
        if (!runtime.context) {
          throw new Error('Runtime context required for token limiting');
        }

        const { userDid } = runtime.context as TChatNodeContext;

        const lastMessage = state.messages.at(-1) as AIMessageChunk;
        if (!lastMessage?.usage_metadata) {
          throw new Error('Usage metadata not available for token limiting');
        }

        const { input_tokens, output_tokens, total_tokens } =
          lastMessage.usage_metadata;

        Logger.debug('Token usage', {
          input_tokens,
          output_tokens,
          total_tokens,
        });
        const credits = TokenLimiter.llmTokenToCredits(total_tokens);
        const result = await TokenLimiter.limit(userDid, credits);

        Logger.debug('Token limit result', { result });

        return state;
      } catch (error) {
        Logger.error('Error in TokenLimiterMiddleware', error);
        if (error instanceof TokenLimiterError) {
          Logger.error('Token limit error', error);
          return {
            ...state,
            messages: [
              ...state.messages,
              new AIMessageChunk({
                content: `Looks like you have run out of tokens. Please upgrade your plan or topup your balance. You have ${error.currentBalance?.toFixed(2)} tokens remaining.`,
              }),
            ],
          };
        }
        throw error;
      }
    },
  });
};

export { createTokenLimiterMiddleware };
