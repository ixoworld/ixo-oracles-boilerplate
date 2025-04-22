import {
  BaseEvent,
  shouldHaveConnectionId,
  type WithRequiredEventProps,
} from '../base-event/base-event';

interface IMessageCacheInvalidation {
  status?: 'isRunning' | 'done';
}

export class MessageCacheInvalidationEvent extends BaseEvent<IMessageCacheInvalidation> {
  constructor(
    public payload: WithRequiredEventProps<IMessageCacheInvalidation>,
  ) {
    payload.status = payload.status ?? 'done';
    super();
    shouldHaveConnectionId(payload);
  }
  public eventName = 'message_cache_invalidation';

  static eventName = 'message_cache_invalidation' as const;
}
