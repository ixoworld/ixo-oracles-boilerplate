import {
  BaseEvent,
  shouldHaveSessionId,
  type WithRequiredEventProps,
} from '../base-event/base-event';
import { EVENT_NAME, type IBrowserToolCallEvent } from './types';

export class BrowserToolCallEvent extends BaseEvent<IBrowserToolCallEvent> {
  constructor(public payload: WithRequiredEventProps<IBrowserToolCallEvent>) {
    super();
    shouldHaveSessionId(payload);
  }
  public eventName = EVENT_NAME;

  static eventName = EVENT_NAME;
}
