import {
  getUserSubscription,
  type GetMySubscriptionsResponseDto,
} from '@ixo/common';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class SubscriptionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SubscriptionMiddleware.name);
  constructor(private readonly configService: ConfigService<ENV>) {}

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

      const { did, matrixAccessToken } = req.authData;

      // Default to devnet, but this could be made configurable
      const network: 'mainnet' | 'testnet' | 'devnet' =
        this.configService.get('NETWORK') ?? 'devnet';

      // Get user subscription
      const subscription = await getUserSubscription({
        userId: did,
        matrixAccessToken,
        network,
      });

      if (!subscription) {
        this.logger.warn(`No subscription found for user: ${did}`);
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

      // syt_ZGlkLWl4by1peG8xNWE3cDlkNG44d2poNndjc3FrNTNnNHlrN3UzenRxcHV5bXpueG4_xkMSYMVvxxsKijVmoeqw_3o5ken

      // Check if subscription is active
      if (subscription.status !== 'active' && subscription.status !== 'trial') {
        this.logger.warn(
          `User ${did} has inactive subscription: ${subscription.status}`,
        );
        // You can choose to block the request here or just log the warning
        // For now, we'll just log and continue
      }

      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Subscription check failed: ${message}`);

      req.subscriptionData = undefined;
      next(error);
    }
  }
}
