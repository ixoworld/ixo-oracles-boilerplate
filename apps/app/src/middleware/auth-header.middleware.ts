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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for declaration merging
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Interface merging with external library
    interface Request {
      authData: {
        did: string;
        userOpenIdToken: string;
        homeServer: string;
      };
    }
  }
}

const THREE_MINUTES = minutes(3);

interface CachedUser {
  did: string;
  homeServer: string;
}

@Injectable()
export class AuthHeaderMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthHeaderMiddleware.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly configService: ConfigService<ENV>,
  ) {}

  private resolveHomeServer(matrixHomeServer?: string): string {
    this.logger.debug(
      `[resolveHomeServer]: matrixHomeServer: ${matrixHomeServer} -> ${this.configService.getOrThrow('MATRIX_BASE_URL')}`,
    );
    if (matrixHomeServer?.trim()) {
      const url = matrixHomeServer.startsWith('http')
        ? matrixHomeServer
        : `https://${matrixHomeServer}`;
      return url;
    }

    return this.configService.getOrThrow('MATRIX_BASE_URL');
  }

  private cropHomeServer(url: string): string {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }

  private async validateToken(
    matrixToken: string,
    matrixHomeServer?: string,
  ): Promise<{
    isValid: boolean;
    userDid: string;
    homeServer: string;
  }> {
    try {
      const isOpenIdToken = !matrixToken.startsWith('syt_');
      if (!isOpenIdToken) {
        throw new HttpException(
          'Invalid token Please use a user open id token',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const homeServerUrl = this.resolveHomeServer(matrixHomeServer);
      this.logger.debug(`Validating OpenID token against ${homeServerUrl}`);

      const { isValid, userId } = await verifyMatrixOpenIdToken(
        matrixToken,
        homeServerUrl,
      );
      if (!userId) {
        return { isValid: false, userDid: '', homeServer: '' };
      }
      return {
        isValid,
        userDid: normalizeDid(userId),
        homeServer: this.cropHomeServer(homeServerUrl),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error validating token: ${errorMessage}`, errorStack);
      return { isValid: false, userDid: '', homeServer: '' };
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    this.logger.debug(
      `AuthHeaderMiddleware processing request for: ${req.originalUrl}`,
    );
    try {
      const { matrixAccessToken, matrixHomeServer } = await getAuthHeaders(
        req.headers,
      );

      const cachedUser = await this.cacheManager.get<CachedUser>(
        `user_${this.hashToken(matrixAccessToken)}`,
      );

      if (cachedUser?.did) {
        req.authData = {
          did: cachedUser.did,
          userOpenIdToken: matrixAccessToken,
          homeServer: cachedUser.homeServer,
        };
        next();
        return;
      }

      const { isValid, userDid, homeServer } = await this.validateToken(
        matrixAccessToken,
        matrixHomeServer,
      );
      if (!isValid) {
        throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
      }

      req.authData = {
        did: userDid,
        userOpenIdToken: matrixAccessToken,
        homeServer,
      };
      await this.cacheManager.set(
        `user_${this.hashToken(matrixAccessToken)}`,
        { did: userDid, homeServer } satisfies CachedUser,
        THREE_MINUTES,
      );
      this.logger.debug(`Auth headers validated for DID: ${userDid}`);
      next();
    } catch (error) {
      if (error instanceof HttpException) {
        next(error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `Auth header validation failed: ${message}`,
          errorStack,
        );
        next(new HttpException(message, 401));
      }
    }
  }
}
