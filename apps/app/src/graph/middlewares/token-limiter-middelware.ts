import { Logger } from '@nestjs/common';
import { AIMessageChunk, createMiddleware } from 'langchain';
import { TokenLimiter } from 'src/utils/token-limit-handler';
import { contextSchema, TChatNodeContext } from '../types';

const createTokenLimiterMiddleware = () => {
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
        throw new Error(
          `Token limit exceeded. You have ${remaining} tokens remaining. ` +
            `Upgrade your plan or wait for tokens to reset.`,
        );
      }

      return state;
    },

    afterModel: async (state, runtime) => {
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
    },
  });
};

export { createTokenLimiterMiddleware };
