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

// Extend Express Request interface to include subscription data
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for declaration merging
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Interface merging with external library
    interface Request {
      subscriptionData?: GetMySubscriptionsResponseDto;
    }
  }
}
const TEN_MINUTES = minutes(10);
@Injectable()
export class SubscriptionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SubscriptionMiddleware.name);
  constructor(
    private readonly configService: ConfigService<ENV>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

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
      });

      if (!subscription) {
        this.logger.debug(`No subscription found for user: ${did}`);
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
      if (subscription.status !== 'active' && subscription.status !== 'trial') {
        throw new HttpException(
          'User has inactive subscription, please subscribe to continue',
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      await this.cacheManager.set(
        `subscription_${did}`,
        subscription,
        TEN_MINUTES,
      );
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // If it's already an HttpException (from lines 80 or 96), throw it to stop the request
      if (error instanceof HttpException) {
        throw error;
      }

      // For any other error, log it and throw a generic payment required error
      this.logger.error(`Subscription check failed: ${message}`);
      req.subscriptionData = undefined;

      throw new HttpException(
        'Subscription validation failed',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}
