import { type AllEvents } from '@ixo/oracles-events';
import { EventEmitter } from 'node:events';

export const WS_SERVICE_EVENT_NAME = 'wsService';

export class Emitter extends EventEmitter {
  override emit(sessionId: string, event: AllEvents): boolean {
    return super.emit(WS_SERVICE_EVENT_NAME, event);
  }
}

export const wsEmitter = new Emitter();
