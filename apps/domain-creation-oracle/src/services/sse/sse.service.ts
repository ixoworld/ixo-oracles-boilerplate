// sse.service.ts
import { Logger } from '@ixo/logger';
import { MessageCacheInvalidationEvent } from '@ixo/oracles-events/server';
import { AllEvents } from '@ixo/oracles-events/types';
import { createSession, Session } from 'better-sse';
import { Request, Response } from 'express';
import httpErrors from 'http-errors';

export class SseService {
  private static instance: SseService;
  private sessions = new Map<string, Session>();

  private constructor() {}

  public static getInstance(): SseService {
    if (!SseService.instance) {
      SseService.instance = new SseService();
    }
    return SseService.instance;
  }

  registerSession(id: string, session: Session) {
    this.sessions.set(id, session);

    session.once('close', () => {
      Logger.info(`[SSE] Closed: ${id}`);
      this.sessions.delete(id);
    });

    session.push({ event: 'connected', id });
  }

  async createAndRegisterSession(req: Request, res: Response) {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      throw httpErrors.BadRequest('Session ID is required');
    }
    const session = await createSession(req, res);
    this.registerSession(sessionId, session);
    return session;
  }

  sendEvent<T extends AllEvents | MessageCacheInvalidationEvent>(
    id: string,
    event: T,
  ) {
    const session = this.sessions.get(id);
    if (!session) {
      Logger.warn(`[SSE] Tried to send to missing session: ${id}`);
      return;
    }

    session.push(event, event.eventName);
  }

  deleteSession(id: string) {
    this.sessions.delete(id);
  }

  isConnected(id: string) {
    return this.sessions.has(id) && this.sessions.get(id)?.isConnected;
  }
}

export default SseService.getInstance();
