import { Logger } from '@ixo/logger';
import { type Socket } from 'socket.io';
import { rootEventEmitter } from '../../root-event-emitter/root-event-emitter';
import {
  BaseEvent,
  shouldHaveConnectionId,
  type WithRequiredEventProps,
} from './base-event';

describe('BaseEvent', () => {
  class TestEvent extends BaseEvent<unknown> {
    public payload: WithRequiredEventProps<unknown>;
    public static readonly eventName = 'testEvent';
    public readonly eventName = TestEvent.eventName;

    constructor(payload: WithRequiredEventProps<unknown>) {
      super();
      this.payload = payload;
    }
  }

  it('should throw an error if used in the browser', () => {
    const originalWindow = global.window;
    global.window = {} as Window & typeof globalThis;
    expect(
      () =>
        new TestEvent({
          connectionId: '123',
          sessionId: '456',
          requestId: '789',
        }),
    ).toThrow('Events should not be used in the browser.');
    global.window = originalWindow;
  });

  it('should throw an error if eventName is not defined', () => {
    class InvalidEvent extends BaseEvent<unknown> {
      public payload: WithRequiredEventProps<unknown>;
      public readonly eventName = '';

      constructor(payload: WithRequiredEventProps<unknown>) {
        super();
        this.payload = payload;
      }
    }

    expect(
      () =>
        new InvalidEvent({
          connectionId: '123',
          sessionId: '456',
          requestId: '789',
        }),
    ).toThrow(
      'Derived classes must define a static eventName property of type string.',
    );
  });

  it('should emit an event with the correct payload', () => {
    const payload = { connectionId: '123', sessionId: '456', requestId: '789' };
    const event = new TestEvent(payload);
    const emitSpy = jest.spyOn(rootEventEmitter, 'emit');
    event.emit();
    expect(emitSpy).toHaveBeenCalledWith(TestEvent.eventName, payload);
  });

  it('should register event handlers correctly', () => {
    const payload = { connectionId: '123', sessionId: '456', requestId: '789' };
    const socket = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as unknown as Socket;
    const logSpy = jest.spyOn(Logger, 'info');
    TestEvent.registerEventHandlers(socket);
    rootEventEmitter.emit(TestEvent.eventName, payload);
    expect(logSpy).toHaveBeenCalled();
    expect(socket.to).toHaveBeenCalledWith(payload.connectionId);
    expect(socket.emit).toHaveBeenCalledWith(TestEvent.eventName, payload);
  });
});

describe('shouldHaveConnectionId', () => {
  it('should throw an error if payload is null or undefined', () => {
    expect(() => shouldHaveConnectionId(null)).toThrow(
      'Payload must be provided and cannot be null or undefined.',
    );
    expect(() => shouldHaveConnectionId(undefined)).toThrow(
      'Payload must be provided and cannot be null or undefined.',
    );
  });

  it('should throw an error if payload is not an object', () => {
    expect(() => shouldHaveConnectionId(123)).toThrow(
      'Payload must be an object. Received: number',
    );
    expect(() => shouldHaveConnectionId('string')).toThrow(
      'Payload must be an object. Received: string',
    );
  });

  it('should throw an error if payload does not include connectionId', () => {
    expect(() => shouldHaveConnectionId({})).toThrow(
      'Payload must include a connectionId property.',
    );
  });

  it('should return the payload if it includes connectionId', () => {
    const payload = { connectionId: '123', sessionId: '456', requestId: '789' };
    expect(shouldHaveConnectionId(payload)).toBe(payload);
  });
});
