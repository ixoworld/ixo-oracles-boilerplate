import { verifyMatrixOpenIdToken } from '@ixo/common';
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
import * as crypto from 'node:crypto';
import { ENV } from 'src/config';
import { getAuthHeaders, normalizeDid } from '../utils/header.utils';

// Extend Express Request interface to include our custom property
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for declaration merging
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Interface merging with external library
    interface Request {
      authData: {
        did: string;
        userOpenIdToken: string;
      };
    }
  }
}

const TEN_MINUTES = minutes(10);

@Injectable()
export class AuthHeaderMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthHeaderMiddleware.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly configService: ConfigService<ENV>,
  ) {}

  private async validateToken(matrixToken: string): Promise<{
    isValid: boolean;
    userDid: string;
  }> {
    try {
      const isOpenIdToken = !matrixToken.startsWith('syt_');
      if (!isOpenIdToken) {
        throw new HttpException(
          'Invalid token Please use a user open id token',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.logger.debug(`Validating OpenID token`);
      const { isValid, userId } = await verifyMatrixOpenIdToken(
        matrixToken,
        this.configService.getOrThrow('MATRIX_BASE_URL'),
      );
      if (!userId) {
        return { isValid: false, userDid: '' };
      }
      return { isValid, userDid: normalizeDid(userId) };
    } catch (error) {
      this.logger.error(`Error validating token: ${error}`);
      return { isValid: false, userDid: '' };
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    this.logger.debug(
      `AuthHeaderMiddleware processing request for: ${req.originalUrl}`,
    );
    try {
      // Extract headers using the utility function
      const { matrixAccessToken } = await getAuthHeaders(req.headers);

      const cachedUser = await this.cacheManager.get<{ did: string }>(
        `user_${this.hashToken(matrixAccessToken)}`,
      );

      if (cachedUser?.did) {
        req.authData = {
          did: cachedUser.did,
          userOpenIdToken: matrixAccessToken,
        };
        next();
        return;
      }

      const { isValid, userDid } = await this.validateToken(matrixAccessToken);
      if (!isValid) {
        throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
      }

      // Attach extracted data to the request object
      req.authData = { did: userDid, userOpenIdToken: matrixAccessToken };
      await this.cacheManager.set(
        `user_${this.hashToken(matrixAccessToken)}`,
        { did: userDid },
        TEN_MINUTES,
      );
      this.logger.debug(`Auth headers validated for DID: ${userDid}`);
      next(); // Proceed to the next middleware or route handler
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auth header validation failed: ${message}`);
      // Pass the original error if it's likely an Http Exception, otherwise wrap it
      if (error instanceof HttpException) {
        next(error);
      } else {
        next(new HttpException(message, 401));
      }
    }
  }
}
