import { type AllEvents } from '@ixo/oracles-events';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger(SseService.name);
  private readonly clientSubjects = new Map<string, Subject<AllEvents>>();

  /**
   * Get or create a stream for a specific session
   */
  getClientStream(sessionId: string): Observable<AllEvents> {
    if (!this.clientSubjects.has(sessionId)) {
      this.logger.log(`Creating new event stream for session: ${sessionId}`);
      this.clientSubjects.set(sessionId, new Subject<AllEvents>());
    }
    this.logger.log(`Returning stream for session: ${sessionId}`);
    return this.clientSubjects.get(sessionId)!.asObservable();
  }

  /**
   * Publish an event to a specific session
   */
  publishToSession(sessionId: string, event: AllEvents): void {
    const subject = this.clientSubjects.get(sessionId);
    if (subject) {
      subject.next(event);
    } else {
      this.logger.warn(
        `Attempted to publish to non-existent session: ${sessionId}`,
      );
    }
  }

  /**
   * Remove a client's event stream when they disconnect
   */
  removeClient(sessionId: string): void {
    const subject = this.clientSubjects.get(sessionId);
    if (subject) {
      subject.complete();
      this.clientSubjects.delete(sessionId);
    }
  }

  onModuleDestroy(): void {
    this.logger.log('Completing all event streams');
    for (const [, subject] of this.clientSubjects.entries()) {
      subject.complete();
    }
    this.clientSubjects.clear();
  }
}
