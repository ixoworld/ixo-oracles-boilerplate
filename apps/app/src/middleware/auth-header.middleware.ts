import {
  HttpException,
  Injectable,
  Logger,
  type NestMiddleware,
} from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { getAuthHeaders } from '../utils/header.utils';

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

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    this.logger.debug(
      `AuthHeaderMiddleware processing request for: ${req.originalUrl}`,
    );
    try {
      // Extract headers using the utility function
      const { did, matrixAccessToken } = await getAuthHeaders(req.headers);

      // Attach extracted data to the request object
      req.authData = { did, matrixAccessToken };

      this.logger.debug(`Auth headers validated for DID: ${did}`);
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
