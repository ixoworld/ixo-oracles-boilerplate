import {
  Controller,
  Logger,
  Query,
  Req,
  Res,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SseService } from './sse.service';

@Controller('sse')
export class SseController {
  private readonly logger = new Logger(SseController.name);
  private readonly activeSessions = new Map<string, Response>();

  constructor(private readonly sse: SseService) {}

  @Sse('events')
  stream(
    @Query('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Observable<MessageEvent> {
    if (!sessionId) {
      this.logger.error('SSE connection attempt without sessionId');
      res.status(400).send('sessionId query parameter is required');
      return new Observable((subscriber) => {
        subscriber.complete();
      });
    }

    this.logger.log(`SSE connection established for session: ${sessionId}`);
    this.activeSessions.set(sessionId, res);

    // Handle client disconnection
    req.on('close', () => {
      this.logger.log(`SSE connection closed for session: ${sessionId}`);
      this.sse.removeClient(sessionId);
      this.activeSessions.delete(sessionId);
    });

    // Get the specific stream for this session
    return this.sse.getClientStream(sessionId).pipe(
      map((data) => {
        return { data };
      }),
    );
  }
}
