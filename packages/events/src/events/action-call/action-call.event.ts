import {
  BaseEvent,
  shouldHaveSessionId,
  type WithRequiredEventProps,
} from '../base-event/base-event';
import { EVENT_NAME, type IActionCallEvent } from './types';

export class ActionCallEvent extends BaseEvent<IActionCallEvent> {
  constructor(public payload: WithRequiredEventProps<IActionCallEvent>) {
    payload.status = payload.status ?? 'isRunning';
    super();
    shouldHaveSessionId(payload);
  }
  public eventName = EVENT_NAME;

  static eventName = EVENT_NAME;
}
