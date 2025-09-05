import { verifyMatrixOpenIdToken } from '@ixo/common';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import {
  getAuthHeaders,
  getLoginResponse,
  normalizeDid,
} from '../utils/header.utils';

// Extend Express Request interface to include our custom property
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for declaration merging
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Interface merging with external library
    interface Request {
      authData: {
        did: string;
        matrixAccessToken: string;
      };
    }
  }
}

@Injectable()
export class AuthHeaderMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthHeaderMiddleware.name);

  private async validateToken(matrixToken: string): Promise<{
    isValid: boolean;
    userDid: string;
  }> {
    try {
      const isOpenIdToken = !matrixToken.startsWith('syt_');
      if (isOpenIdToken) {
        this.logger.debug(`Validating OpenID token`);
        const { isValid, userId } = await verifyMatrixOpenIdToken(matrixToken);
        if (!userId) {
          return { isValid: false, userDid: '' };
        }
        return { isValid, userDid: normalizeDid(userId) };
      }
      const loginResponse = await getLoginResponse(matrixToken);
      const did = normalizeDid(loginResponse.user_id);
      return { isValid: true, userDid: did };
    } catch (error) {
      this.logger.error(`Error validating token: ${error}`);
      return { isValid: false, userDid: '' };
    }
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    this.logger.debug(
      `AuthHeaderMiddleware processing request for: ${req.originalUrl}`,
    );
    try {
      // Extract headers using the utility function
      const { matrixAccessToken } = await getAuthHeaders(req.headers);

      const { isValid, userDid } = await this.validateToken(matrixAccessToken);
      if (!isValid) {
        throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
      }

      // Attach extracted data to the request object
      req.authData = { did: userDid, matrixAccessToken };

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
