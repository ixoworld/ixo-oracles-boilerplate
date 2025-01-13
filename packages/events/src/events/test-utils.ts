/* eslint-disable @typescript-eslint/unbound-method -- This is a utility function */
import { Logger } from '@ixo/logger';
import { type Socket } from 'socket.io';
import { rootEventEmitter } from 'src/root-event-emitter';
import { type AllEventsAsClass } from 'src/types';

/**
 * Utility function to test if an event should be registered.
 *
 * @param EventClass - The class of the event to be registered.
 * @param payload - The payload of the event.
 *
 * @remarks
 * This function mocks a socket and spies on the Logger's `info` method to verify
 * that event handlers are registered correctly. It emits the event using the
 * `rootEventEmitter` and checks that the appropriate log message is generated
 * and that the socket's `to` and `emit` methods are called with the correct arguments.
 */
export const shouldRegisterEvent = <
  C extends (typeof AllEventsAsClass)[number],
>(
  EventClass: C,
  payload: InstanceType<C>['payload'],
): boolean => {
  const socket = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as Socket;
  const logSpy = jest.spyOn(Logger, 'info');

  EventClass.registerEventHandlers(socket);
  rootEventEmitter.emit(EventClass.eventName, payload);

  expect(logSpy).toHaveBeenCalled();
  expect(socket.to).toHaveBeenCalledWith(payload.connectionId);
  expect(socket.emit).toHaveBeenCalledWith(EventClass.eventName, payload);

  return true;
};
