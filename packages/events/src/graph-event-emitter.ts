import { type Socket } from 'socket.io';
import { RenderComponentEvent } from './events';
import { MessageCacheInvalidationEvent } from './events/message-cache-invalidation';
import { RouterEvent } from './events/router-event/router.event';
import { ToolCallEvent } from './events/tool-call/tool-call.event';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- this class is used in the gateway
export class GraphEventEmitter {
  static registerEventHandlers(server: Socket): void {
    RouterEvent.registerEventHandlers(server);
    ToolCallEvent.registerEventHandlers(server);
    RenderComponentEvent.registerEventHandlers(server);
    MessageCacheInvalidationEvent.registerEventHandlers(server);
  }
}
