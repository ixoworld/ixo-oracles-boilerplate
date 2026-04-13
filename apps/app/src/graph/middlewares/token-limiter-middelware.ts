import type { InteropZodObject } from '@langchain/core/utils/types';
import { Logger } from '@nestjs/common';
import {
  type AgentMiddleware,
  AIMessageChunk,
  createMiddleware,
} from 'langchain';
import { getConfig, isRedisEnabled } from 'src/config';
import { TokenLimiter, TokenLimiterError } from 'src/utils/token-limit-handler';
import { getModelPricing } from '../llm-provider';
import { contextSchema, type TChatNodeContext } from '../types';

const config = getConfig();
const createTokenLimiterMiddleware = (): AgentMiddleware => {
  return createMiddleware({
    name: 'TokenLimiterMiddleware',
    contextSchema: contextSchema as unknown as InteropZodObject,
    beforeModel: async (state, runtime) => {
      const disableCredits = config.get('DISABLE_CREDITS');
      if (disableCredits || !isRedisEnabled()) {
        Logger.debug('Token limiting skipped (credits disabled or no Redis)');
        return state;
      }
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
        const disableCredits = config.get('DISABLE_CREDITS');
        if (disableCredits || !isRedisEnabled()) {
          Logger.debug('Token limiting skipped (credits disabled or no Redis)');
          return state;
        }

        const { userDid } = runtime.context as TChatNodeContext;

        const lastMessage = state.messages.at(-1) as AIMessageChunk;
        if (!lastMessage?.usage_metadata) {
          throw new Error('Usage metadata not available for token limiting');
        }

        const { input_tokens, output_tokens, total_tokens } =
          lastMessage.usage_metadata;

        // Priority 1: Use exact USD cost from provider (OpenRouter includes this)
        const responseMeta = lastMessage.response_metadata as
          | { usage?: { cost?: number }; model?: string }
          | undefined;
        const providerCost =
          typeof responseMeta?.usage?.cost === 'number'
            ? responseMeta.usage.cost
            : undefined;

        let credits: number;
        if (providerCost != null && providerCost > 0) {
          credits = TokenLimiter.usdCostToCredits(providerCost);
          Logger.log(
            `[TokenLimiter] Using provider cost: $${providerCost} → ${credits} credits`,
          );
        } else {
          // Priority 2: Per-model pricing from cache
          const model = responseMeta?.model;
          const pricing = model ? getModelPricing(model) : null;

          if (pricing) {
            credits = TokenLimiter.llmTokenToCreditsWithPricing(
              input_tokens,
              output_tokens,
              pricing,
            );
            Logger.log(
              `[TokenLimiter] Using cached pricing for model=${model} → ${credits} credits`,
            );
          } else {
            // Priority 3: Flat-rate fallback
            credits = TokenLimiter.llmTokenToCredits(total_tokens);
            Logger.log(
              `[TokenLimiter] Using flat-rate fallback (model=${model ?? 'unknown'}) → ${credits} credits`,
            );
          }
        }

        Logger.log(
          `[TokenLimiter] input=${input_tokens} output=${output_tokens} total=${total_tokens} | credits=${credits}`,
        );

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
