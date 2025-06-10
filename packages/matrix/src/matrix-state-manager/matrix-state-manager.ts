import { Logger } from '@ixo/logger';
import * as sdk from 'matrix-js-sdk';
import { parse, stringify } from 'superjson';
import { type OraclesNamesOnMatrix } from '../types';

interface IStatePayload<C> {
  roomId: string;
  stateKey: `${OraclesNamesOnMatrix}_${string}`;
  data: C;
}

export class MatrixStateManager {
  constructor(private readonly client: sdk.MatrixClient) {}

  private validateRoom(roomId: string): void {
    const roomRegex =
      /^!(?<roomId>[a-zA-Z0-9]+):(?<domain>(?<temp2>localhost|[a-zA-Z0-9.]+)(?<temp1>:\d{1,5})?)?$/;
    if (!roomRegex.test(roomId)) {
      Logger.error(`Invalid room ID: ${roomId}`);
      throw new Error(`Invalid room ID: ${roomId}`);
    }
  }

  async getState<C>(
    roomId: string,
    stateKey: `${OraclesNamesOnMatrix}_${string}`,
  ): Promise<C> {
    this.validateRoom(roomId);

    const stateEvent = await this.client.getStateEvent(
      roomId,
      'ixo.room.state',
      stateKey,
    );

    const content = stateEvent.data as unknown;

    if (typeof content !== 'string') {
      throw new Error(`Invalid content type: ${typeof content}`);
    }

    try {
      const v = parse(content);
      return v as C;
    } catch (error) {
      Logger.error('Error parsing content', error);
      throw error;
    }
  }

  async setState<C>(payload: IStatePayload<C>): Promise<void> {
    try {
      await this.client.sendStateEvent(
        payload.roomId,
        'ixo.room.state' as keyof sdk.StateEvents,
        {
          data: stringify(payload.data),
        } as sdk.StateEvents[keyof sdk.StateEvents],
        payload.stateKey,
      );
    } catch (error) {
      Logger.error('Error setting state', error);
      throw error;
    }
  }

  async updateState<C>(payload: IStatePayload<C>): Promise<C> {
    let oldState: C | undefined;
    try {
      oldState = await this.getState<C>(payload.roomId, payload.stateKey);
    } catch (error) {
      oldState = undefined;
    }

    const newState = oldState ? { ...oldState, ...payload.data } : payload.data;

    await this.setState({
      ...payload,
      data: newState,
    });

    return newState;
  }

  async listStateEvents<D>(room: sdk.Room): Promise<D[]> {
    const data: D[] = [];

    // Start paginating backward.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition -- we need to paginate the timeline
    while (true) {
      // `client.scrollback` will paginate more events into the timeline.
      // eslint-disable-next-line no-await-in-loop -- we need to paginate the timeline
      await this.client.scrollback(room, 100); // The second argument is the number of events to load.

      // After the scrollback, check if we're at the start of the timeline.
      const timeline = room.getLiveTimeline();
      if (!timeline.getPaginationToken(sdk.Direction.Backward)) {
        break;
      }

      // Iterate through the timeline and handle each event as needed.
      const events = timeline.getEvents();
      for (const event of events) {
        const content = event.getContent<{
          data: string;
        }>().data;
        if (content) {
          try {
            const parsedContent = parse(content);
            data.push(parsedContent as D);
          } catch (error) {
            Logger.error('Error parsing content', error);
          }
        }
      }
    }

    return data;
  }
}
