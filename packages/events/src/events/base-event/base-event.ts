import { Logger } from '@ixo/logger';
import { type Socket } from 'socket.io';
import { rootEventEmitter } from '../../root-event-emitter/root-event-emitter';

export const shouldHaveConnectionId = <P>(
  payload: P,
): WithRequiredEventProps<P> => {
  if (!payload) {
    throw new TypeError(
      'Payload must be provided and cannot be null or undefined.',
    );
  }
  if (typeof payload !== 'object') {
    throw new TypeError(
      `Payload must be an object. Received: ${typeof payload}`,
    );
  }

  if (!('connectionId' in payload)) {
    throw new TypeError('Payload must include a connectionId property.');
  }

  return payload as WithRequiredEventProps<P>;
};

/**
 * Abstract class representing a base event.
 * P - The type of the payload associated with the event.
 */
export abstract class BaseEvent<P> {
  /** The event's payload, which must include a sessionId. */
  protected abstract payload: WithRequiredEventProps<P>;
  abstract readonly eventName: string;

  static readonly eventName: string;

  constructor() {
    if (typeof window !== 'undefined') {
      throw new Error('Events should not be used in the browser.');
    }

    if (typeof (this.constructor as typeof BaseEvent).eventName !== 'string') {
      throw new Error(
        'Derived classes must define a static eventName property of type string.',
      );
    }
  }

  /**
   * Register event handlers for this event
   *  @param socket - The socket to register the event handlers on
   *  @returns void
   *
   * This method registers event handlers for this event on the provided socket.
   * When the event is emitted, the event handlers will be called with the provided data. and the data will be sent to WS client with the provided sessionId.
   */
  static registerEventHandlers(socket: Socket): void {
    rootEventEmitter.on(this.eventName, (data) => {
      const payload = shouldHaveConnectionId(data);
      Logger.info(
        `Emitting WS event: ${this.eventName} with payload:`,
        payload,
      );
      socket.to(payload.connectionId).emit(this.eventName, data);
    });
  }

  /**
   * Emit the event
   * @param payload - The payload to emit with the event
   * @returns void
   *
   * This method emits the event with the provided payload.
   */

  public emit(): void {
    if (!this.eventName) {
      throw new Error('Event name must be provided.');
    }
    if (!this.payload.connectionId) {
      throw new Error('Connection ID must be provided.');
    }
    Logger.info(
      `Emitting event: ${this.eventName} with payload:`,
      this.payload,
    );
    rootEventEmitter.emit(this.eventName, this.payload);
  }
}

export type WithRequiredEventProps<P> = P & {
  readonly connectionId: string;

  /**
   * The session ID associated with the chat
   * Each chat conversation has a unique session ID
   */
  readonly sessionId: string;
  /**
   * The request ID associated with the chat
   * Each message in a chat conversation has a unique request ID
   */
  readonly requestId: string;
};
