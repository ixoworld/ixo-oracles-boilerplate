import {
  getUserSubscription,
  type GetMySubscriptionsResponseDto,
} from '@ixo/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { minutes } from '@nestjs/throttler';
import { type NextFunction, type Request, type Response } from 'express';
import { ENV } from 'src/config';
import { TokenLimiter } from 'src/utils/token-limit-handler';

// Extend Express Request interface to include subscription data
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for declaration merging
  namespace Express {
    interface Request {
      subscriptionData?: GetMySubscriptionsResponseDto;
    }
  }
}

// Cache for 3 minutes (shorter than cron interval to prevent stale data)
const THREE_MINUTES = minutes(3);
@Injectable()
export class SubscriptionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SubscriptionMiddleware.name);
  constructor(
    private readonly configService: ConfigService<ENV>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private checkCanContinue(
    subscription: GetMySubscriptionsResponseDto,
  ): boolean {
    const disableCredits = this.configService.get('DISABLE_CREDITS', false);
    if (disableCredits) {
      this.logger.debug('Subscription check skipped (DISABLE_CREDITS=true)');
      return true;
    }
    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      throw new HttpException(
        'User has inactive subscription, please subscribe to continue',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    if (subscription.totalCredits <= 10) {
      throw new HttpException(
        'User has less than 10 credits, please top up to continue',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    this.logger.debug(
      `SubscriptionMiddleware processing request for: ${req.originalUrl}`,
    );

    try {
      // Check if authData is available (set by AuthHeaderMiddleware)
      if (!req.authData) {
        this.logger.warn('No auth data available, skipping subscription check');
        req.subscriptionData = undefined;
        return next();
      }

      const { did, userOpenIdToken: matrixAccessToken } = req.authData;

      const cachedSubscription =
        await this.cacheManager.get<GetMySubscriptionsResponseDto>(
          `subscription_${did}`,
        );

      if (cachedSubscription) {
        this.logger.debug(`Subscription found in cache for user: ${did}`);
        this.logger.debug(`Subscription`, cachedSubscription);
        req.subscriptionData = cachedSubscription;
        this.checkCanContinue(cachedSubscription);
        await TokenLimiter.setSubscriptionPayload(did, cachedSubscription);
        await TokenLimiter.overrideUserBalance(
          did,
          cachedSubscription.totalCredits,
        );
        next();
        return;
      }

      // Default to devnet, but this could be made configurable
      const network: 'mainnet' | 'testnet' | 'devnet' =
        this.configService.get('NETWORK') ?? 'devnet';

      // Get user subscription
      const subscription = await getUserSubscription({
        bearerToken: matrixAccessToken,
        network,
        subscriptionUrl: this.configService.get('SUBSCRIPTION_URL'),
      });

      this.logger.debug(
        `Subscription API response for user ${did}:`,
        JSON.stringify(subscription, null, 2),
      );

      if (!subscription) {
        this.logger.warn(
          `No subscription found for user: ${did}. This could mean: 1) API returned non-OK status, 2) API returned null/undefined data, 3) API call failed with error`,
        );
        req.subscriptionData = undefined;

        // throw error
        throw new HttpException(
          'No subscription found, please subscribe to continue',
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      // Extract relevant subscription data
      req.subscriptionData = subscription;

      this.logger.debug(
        `Subscription validated for user: ${did}, status: ${subscription.status}`,
      );

      // Check if subscription is active
      this.checkCanContinue(subscription);
      await TokenLimiter.setSubscriptionPayload(did, subscription);
      await TokenLimiter.overrideUserBalance(did, subscription.totalCredits);
      await this.cacheManager.set(
        `subscription_${did}`,
        subscription,
        THREE_MINUTES,
      );
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // If it's already an HttpException (from lines 80 or 96), throw it to stop the request
      if (error instanceof HttpException) {
        this.logger.error(
          `Subscription validation failed: ${message}`,
          errorStack,
        );
        throw error;
      }

      // For any other error, log it and throw a generic payment required error
      this.logger.error(`Subscription check failed: ${message}`, errorStack);
      req.subscriptionData = undefined;

      throw new HttpException(
        'Subscription validation failed',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}
