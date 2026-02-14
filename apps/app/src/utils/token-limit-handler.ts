import { type GetMySubscriptionsResponseDto } from '@ixo/common';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { type Serialized } from '@langchain/core/load/serializable';
import { type LLMResult } from '@langchain/core/outputs';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { type ENV } from 'src/config';
import z from 'zod';
import { RedisService } from './redis.service';

const configService = new ConfigService<ENV>();

export class TokenLimiter {
  static readonly KEY_PREFIX = 'token_limit:';
  static readonly KEY_BALANCE = 'balance';
  static readonly KEY_HELD_AMOUNTS = 'held_amounts';
  static readonly KEY_SUBSCRIPTION_PAYLOAD = 'subscription_payload';
  static readonly KEY_PENDING_CLAIM = 'pending_claim';

  // Lua script for atomic token limiting with float support
  private static readonly LIMIT_TOKENS_SCRIPT = `
    local balanceKey = KEYS[1]
    local heldAmountsKey = KEYS[2]
    local userDid = ARGV[1]
    local tokenCount = tonumber(ARGV[2])
    
    -- Decrement balance using float operation
    local newBalance = tonumber(redis.call('INCRBYFLOAT', balanceKey, -tokenCount))
    
    -- Check if balance is negative
    if newBalance < 0 then
      -- Rollback: increment balance back
      redis.call('INCRBYFLOAT', balanceKey, tokenCount)
      return {0, newBalance + tokenCount, 'INSUFFICIENT_BALANCE'}
    end
    
    -- Increment held amount using sorted set operation (ZINCRBY)
    redis.call('ZINCRBY', heldAmountsKey, tokenCount, userDid)
    
    return {1, newBalance, 'SUCCESS'}
  `;

  static getSubscriptionPayloadKey(userDid: string) {
    return `${TokenLimiter.KEY_PREFIX + userDid}:${
      TokenLimiter.KEY_SUBSCRIPTION_PAYLOAD
    }`;
  }

  static async setSubscriptionPayload(
    userDid: string,
    payload: Pick<
      GetMySubscriptionsResponseDto,
      'adminAddress' | 'claimCollections' | 'totalCredits'
    >,
  ): Promise<void> {
    await RedisService.getClient().set(
      TokenLimiter.getSubscriptionPayloadKey(userDid),
      JSON.stringify({
        adminAddress: payload.adminAddress,
        claimCollections: payload.claimCollections,
        totalCredits: payload.totalCredits,
      }),
    );
  }

  static llmTokenToCredits(tokenCount: number): number {
    // Cost is $0.75 per 1M tokens
    // GROQ - OSS 120b model
    // Returns credits as float (1 credit = 1 uixo)

    const markup = configService.getOrThrow('NETWORK') === 'mainnet' ? 1.3 : 10;
    const costPerMillionTokens = 0.75 * markup; // 30% markup for profit
    const tokensPerMillion =
      configService.getOrThrow('NETWORK') === 'mainnet' ? 1_000_000 : 1;

    return Math.round((tokenCount / tokensPerMillion) * costPerMillionTokens);
  }

  static async getSubscriptionPayload(
    userDid: string,
  ): Promise<Pick<
    GetMySubscriptionsResponseDto,
    'adminAddress' | 'claimCollections' | 'totalCredits'
  > | null> {
    const payload = await RedisService.getClient().get(
      TokenLimiter.getSubscriptionPayloadKey(userDid),
    );
    return payload ? JSON.parse(payload) : null;
  }

  static getUserBalanceKey(userDid: string): string {
    return `${TokenLimiter.KEY_PREFIX + userDid}:${TokenLimiter.KEY_BALANCE}`;
  }

  static async getUserHeldAmount(userDid: string): Promise<number> {
    const result = await RedisService.getClient().zscore(
      TokenLimiter.KEY_HELD_AMOUNTS,
      userDid,
    );
    return result ? parseFloat(result) : 0;
  }

  static async incrementUserHeldAmount(
    userDid: string,
    amount: number,
  ): Promise<void> {
    await RedisService.getClient().zincrby(
      TokenLimiter.KEY_HELD_AMOUNTS,
      amount,
      userDid,
    );
  }

  static async deleteUserHeldAmount(userDid: string): Promise<void> {
    await RedisService.getClient().zrem(TokenLimiter.KEY_HELD_AMOUNTS, userDid);
  }

  /**
   * List all users with a held amount
   * @returns A list of users with their held amount (in credits as floats)
   */
  static async listUsersWithHeldAmount(
    amount: number,
  ): Promise<[string, number][]> {
    const raw = await RedisService.getClient().zrangebyscore(
      TokenLimiter.KEY_HELD_AMOUNTS,
      amount,
      '+inf',
      'WITHSCORES',
    );
    const result: [string, number][] = [];

    for (let i = 0; i < raw.length; i += 2) {
      result.push([raw[i], parseFloat(raw[i + 1])]);
    }

    return result;
  }

  /**
   *
   * @param userDid - The user DID to set the balance for
   * @param balance - The balance to set for the user (in credits)
   * @returns The key used to store the balance
   *
   * This is to be used by the subscription middleware to set the balance for the user.
   * it will validate if their is any pending claims or holds on the user's account. then will set the correct balance.
   */
  static async overrideUserBalance(
    userDid: string,
    balance: number,
  ): Promise<string> {
    z.number().parse(balance);
    const heldAmount = await TokenLimiter.getUserHeldAmount(userDid);
    const newBalance = balance - heldAmount;

    // Validate for negative balance (indicates sync issue)
    if (newBalance < 0) {
      Logger.error(
        `CRITICAL: Held amount (${heldAmount}) exceeds chain balance (${balance}) for user ${userDid}. `,
      );
      // Set to 0 to prevent negative balance corruption
      await RedisService.getClient().set(
        TokenLimiter.getUserBalanceKey(userDid),
        '0',
      );

      if (configService.getOrThrow('DISABLE_CREDITS')) {
        return '0';
      }
      throw new HttpException(
        `It looks like you have some usage pending that’s higher than your current balance (${balance / 1000}). Please add more credits to your account to continue. If you think this is a mistake, please contact support. (Held: ${heldAmount / 1000})`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await RedisService.getClient().set(
      TokenLimiter.getUserBalanceKey(userDid),
      newBalance.toString(),
    );

    Logger.debug(
      `Overriding balance for user ${userDid} to current balance: ${newBalance}, held amount: ${heldAmount}, subscription balance: ${balance}`,
    );

    return newBalance.toString();
  }

  static async getUserBalance(userDid: string): Promise<number> {
    const balance = await RedisService.getClient().get(
      TokenLimiter.getUserBalanceKey(userDid),
    );
    return balance ? parseFloat(balance) : 0;
  }

  /**
   * Limit the number of tokens for a user
   * @param userDid - The user DID to limit the tokens for
   * @param credits - The number of credits to limit (float)
   * @returns The remaining balance
   *
   * This will decrement the balance by the credit count and add the held amount to the balance.
   * So taking away 0.005156 credits will decrement the balance by 0.005156 and add 0.005156 to the held amount.
   *
   * The held amount will be processed asynchronously in the background.
   * Uses Lua script for atomic execution - both balance decrement and held amount increment
   * happen atomically, preventing race conditions.
   */
  static async limit(
    userDid: string,
    credits: number,
  ): Promise<{ success: boolean; remaining: number }> {
    const client = RedisService.getClient();
    const balanceKey = TokenLimiter.getUserBalanceKey(userDid);
    const heldAmountsKey = TokenLimiter.KEY_HELD_AMOUNTS;

    try {
      const result = (await client.eval(
        TokenLimiter.LIMIT_TOKENS_SCRIPT,
        2, // Number of keys
        balanceKey,
        heldAmountsKey,
        userDid,
        credits.toString(),
      )) as [number, number, string];

      const [success, balance, status] = result;

      if (success === 0) {
        throw new TokenLimiterError(
          `Insufficient balance. Current balance: ${balance}`,
          'token',
          credits,
          undefined,
          balance,
        );
      }

      Logger.debug(
        `Limited ${credits} credits for user ${userDid}, remaining: ${balance}`,
      );
      return { success: true, remaining: balance };
    } catch (error) {
      if (error instanceof TokenLimiterError) {
        throw error;
      }
      Logger.error(
        `Failed to limit tokens for user ${userDid}: ${error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new TokenLimiterError(
        'Failed to process token limit',
        'token',
        credits,
      );
    }
  }

  static async getRemaining(userDid: string): Promise<number> {
    const result = await RedisService.getClient().get(
      TokenLimiter.getUserBalanceKey(userDid),
    );
    return result ? parseFloat(result) : 0;
  }

  /**
   * Generate deterministic claim ID using hash of userDid + batchStartTime
   * This ensures retries use the same claim ID, preventing duplicate claims
   * @param userDid - The user DID
   * @param batchStartTime - Timestamp when the batch started (first token held)
   * @returns Deterministic claim ID (format: claim_{hash})
   */
  static generateClaimId(userDid: string, batchStartTime: number): string {
    const data = `${userDid}:${batchStartTime}`;
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `claim_${hash.slice(0, 32)}`;
  }

  static getPendingClaimKey(userDid: string): string {
    return `${TokenLimiter.KEY_PREFIX + userDid}:${TokenLimiter.KEY_PENDING_CLAIM}`;
  }

  /**
   * Store pending claim with deterministic ID
   * @param userDid - The user DID
   * @param claimId - The deterministic claim ID
   * @param amount - The amount being claimed
   * @param batchStartTime - Optional timestamp when batch started (defaults to now)
   */
  static async setPendingClaim(
    userDid: string,
    claimId: string,
    amount: number,
    batchStartTime?: number,
  ): Promise<void> {
    const now = Date.now();
    const payload = {
      claimId,
      amount,
      timestamp: now, // Last updated
      batchStartTime: batchStartTime ?? now, // When batch started
    };

    await RedisService.getClient().set(
      TokenLimiter.getPendingClaimKey(userDid),
      JSON.stringify(payload),
      'EX',
      60 * 60, // Expire after 1 hour (safety cleanup)
    );
  }

  /**
   * Get pending claim for user
   * @param userDid - The user DID
   * @returns Pending claim data or null if not found
   */
  static async getPendingClaim(userDid: string): Promise<{
    claimId: string;
    amount: number;
    timestamp: number;
    batchStartTime: number;
  } | null> {
    const data = await RedisService.getClient().get(
      TokenLimiter.getPendingClaimKey(userDid),
    );
    return data ? JSON.parse(data) : null;
  }

  /**
   * Clear pending claim after successful submission
   * @param userDid - The user DID
   */
  static async clearPendingClaim(userDid: string): Promise<void> {
    await RedisService.getClient().del(
      TokenLimiter.getPendingClaimKey(userDid),
    );
  }

  /**
   * Update the amount in an existing pending claim without changing the claim ID
   * This allows accumulating tokens in the same claim batch
   * @param userDid - The user DID
   * @param newAmount - The new total amount
   */
  static async updatePendingClaimAmount(
    userDid: string,
    newAmount: number,
  ): Promise<void> {
    const pending = await TokenLimiter.getPendingClaim(userDid);
    if (!pending) {
      Logger.warn(
        `Attempted to update pending claim amount for ${userDid}, but no pending claim exists`,
      );
      return;
    }

    await TokenLimiter.setPendingClaim(
      userDid,
      pending.claimId, // Keep same claim ID
      newAmount,
      pending.batchStartTime, // Keep original batch start time
    );

    Logger.debug(
      `Updated pending claim ${pending.claimId} amount from ${pending.amount} to ${newAmount} for user ${userDid}`,
    );
  }

  /**
   * Get existing pending claim or create a new one
   * If the held amount changed, updates the pending claim amount but keeps same claim ID
   * @param userDid - The user DID
   * @param currentHeldAmount - Current total held amount
   * @returns The claim ID to use for submission
   */
  static async getOrCreatePendingClaim(
    userDid: string,
    currentHeldAmount: number,
  ): Promise<string> {
    const pending = await TokenLimiter.getPendingClaim(userDid);

    if (pending) {
      // Update amount if it changed (user used more tokens)
      if (pending.amount !== currentHeldAmount) {
        Logger.debug(
          `Held amount changed from ${pending.amount} to ${currentHeldAmount} for user ${userDid}. Updating pending claim.`,
        );
        await TokenLimiter.updatePendingClaimAmount(userDid, currentHeldAmount);
      }
      return pending.claimId; // Keep same claim ID for retries and accumulation
    }

    // No pending claim exists, create new one
    const batchStartTime = Date.now();
    const claimId = TokenLimiter.generateClaimId(userDid, batchStartTime);

    await TokenLimiter.setPendingClaim(
      userDid,
      claimId,
      currentHeldAmount,
      batchStartTime,
    );

    Logger.debug(
      `Created new pending claim ${claimId} for user ${userDid} with amount ${currentHeldAmount}`,
    );

    return claimId;
  }
}

/**
 * Upstash Ratelimit Error
 *
 * Raised when the rate limit is reached in `TokenLimiterHandler`.
 */
class TokenLimiterError extends Error {
  type: 'token' | 'request';

  limit?: number;
  currentBalance?: number;

  reset?: number;

  /**
   * @param message - Error message
   * @param type - The kind of limit which was reached. One of "token" or "request"
   * @param limit - The limit which was reached. Passed when type is request
   * @param reset - Unix timestamp in milliseconds when the limits are reset. Passed when type is request
   */
  constructor(
    message: string,
    type: 'token' | 'request',
    limit?: number,
    reset?: number,
    currentBalance?: number,
  ) {
    super(message);
    this.type = type;
    this.limit = limit;
    this.reset = reset;
  }
}

interface TokenLimiterHandlerOptions {
  includeOutputTokens?: boolean;

  llmOutputTokenUsageField?: string;
  llmOutputTotalTokenField?: string;
  llmOutputPromptTokenField?: string;
}

/**
 * Callback to handle rate limiting based on the number of requests
 * or the number of tokens in the input.
 *
 * It uses Upstash Ratelimit to track the rate limit which utilizes
 * Upstash Redis to track the state.
 *
 * Should not be passed to the chain when initializing the chain.
 * This is because the handler has a state which should be fresh
 * every time invoke is called. Instead, initialize and pass a handler
 * every time you invoke.
 */
class TokenLimiterHandler extends BaseCallbackHandler {
  name = 'TokenLimiter';

  raiseError = true;

  identifier: string;

  includeOutputTokens: boolean;

  llmOutputTokenUsageField: string;

  llmOutputTotalTokenField: string;

  llmOutputPromptTokenField: string;

  /**
   * @param identifier - The identifier to rate limit, like a user ID or an IP address
   * @param options - Ratelimit options
   */
  constructor(identifier: string, options: TokenLimiterHandlerOptions) {
    super();

    this.identifier = identifier;
    this.includeOutputTokens = options.includeOutputTokens ?? false;

    this.llmOutputTokenUsageField =
      options.llmOutputTokenUsageField ?? 'tokenUsage';
    this.llmOutputTotalTokenField =
      options.llmOutputTotalTokenField ?? 'totalTokens';
    this.llmOutputPromptTokenField =
      options.llmOutputPromptTokenField ?? 'promptTokens';
  }

  /**
   * Run when the LLM starts running.
   *
   * @param _llm - Serialized LLM
   * @param _prompts - Prompts passed to the LLM
   * @throws TokenLimiterError - If the token rate limit is reached
   */
  async handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    _runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _name?: string,
  ): Promise<void> {
    const remaining = await TokenLimiter.getRemaining(this.identifier);

    if (remaining <= 0) {
      throw new TokenLimiterError('Token limit reached!', 'token');
    }
  }

  /**
   * Run when the LLM ends running.
   *
   * If the `includeOutputTokens` is set to true, the number of tokens
   * in the LLM completion are counted for rate limiting.
   *
   * @param output - LLM result output
   * @throws Error - If the LLM response does not include required token usage information
   */
  async handleLLMEnd(
    output: LLMResult,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
  ): Promise<void> {
    const llmOutput = output.llmOutput || {};
    try {
      const tokenUsage = llmOutput[this.llmOutputTokenUsageField];
      const tokenCount = this.includeOutputTokens
        ? tokenUsage[this.llmOutputTotalTokenField]
        : tokenUsage[this.llmOutputPromptTokenField];

      if (tokenCount !== undefined) {
        const credits = TokenLimiter.llmTokenToCredits(tokenCount);
        await TokenLimiter.limit(this.identifier, credits);
      } else {
        throw new Error('tokenCount not found in llm output');
      }
    } catch (error) {
      if (error instanceof TokenLimiterError) {
        throw error;
      }
      Logger.error(
        `Failed to log token usage for rate limit. It could be because the LLM returns the token usage in a different format than expected. See TokenLimiterHandler parameters. Got error: ${error}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Creates a new TokenLimiterHandler object with the same
   * ratelimit configurations but with a new identifier if it's
   * provided.
   *
   * Also resets the state of the handler.
   *
   * @param identifier - Optional new identifier to use for the new handler instance
   * @returns New TokenLimiterHandler instance
   */
  reset(identifier?: string): TokenLimiterHandler {
    return new TokenLimiterHandler(identifier ?? this.identifier, {
      includeOutputTokens: this.includeOutputTokens,
    });
  }
}

export {
  TokenLimiterError,
  TokenLimiterHandler,
  type TokenLimiterHandlerOptions,
};
