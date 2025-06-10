import { type AllEvents } from '@ixo/oracles-events';
import { EventEmitter } from 'node:events';

export const SSE_SERVICE_EVENT_NAME = 'sseService';

export class Emitter extends EventEmitter {
  override emit(sessionId: string, event: AllEvents): boolean {
    return super.emit(SSE_SERVICE_EVENT_NAME, event);
  }
}

export const sseEmitter = new Emitter();
