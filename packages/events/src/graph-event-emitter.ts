import { type DefaultEventsMap, type Server } from 'socket.io';
import {
  BrowserToolCallEvent,
  ReasoningEvent,
  RenderComponentEvent,
} from './events';
import { MessageCacheInvalidationEvent } from './events/message-cache-invalidation';
import { RouterEvent } from './events/router-event/router.event';
import { ToolCallEvent } from './events/tool-call/tool-call.event';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- this class is used in the gateway
export class GraphEventEmitter {
  static registerEventHandlers(
    server: Server<DefaultEventsMap, DefaultEventsMap>,
  ): void {
    RouterEvent.registerEventHandlers(server);
    ToolCallEvent.registerEventHandlers(server);
    RenderComponentEvent.registerEventHandlers(server);
    MessageCacheInvalidationEvent.registerEventHandlers(server);
    BrowserToolCallEvent.registerEventHandlers(server);
    ReasoningEvent.registerEventHandlers(server);
  }
}
