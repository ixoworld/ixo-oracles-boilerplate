import { Logger } from '@ixo/logger';
import * as sdk from 'matrix-js-sdk';
import { deflateSync, inflateSync } from 'node:zlib';
import { parse, stringify } from 'superjson';

interface IStatePayload<C> {
  roomId: string;
  stateKey: string;
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

  private async parseContent<C>(
    content: string,
    roomId: string,
    stateKey: string,
  ): Promise<C> {
    // Try new format first (zlib compressed)
    try {
      const compressed = Buffer.from(content, 'base64');
      const jsonBuf = inflateSync(compressed);
      const str = jsonBuf.toString('utf8');
      return parse(str);
    } catch (zlibError) {
      const zlibErrorMsg =
        zlibError instanceof Error ? zlibError.message : String(zlibError);
      Logger.info(
        `Failed to parse with zlib compression for ${stateKey} in room ${roomId}, attempting legacy format migration`,
      );

      // Try old format (uncompressed superjson)
      try {
        const legacyData = parse(content);
        Logger.warn(
          `Successfully parsed legacy format for ${stateKey} in room ${roomId}, migrating to new format`,
        );

        // Migrate to new format
        await this.migrateToNewFormat(roomId, stateKey, legacyData);

        return legacyData as C;
      } catch (legacyError) {
        const legacyErrorMsg =
          legacyError instanceof Error
            ? legacyError.message
            : String(legacyError);
        Logger.error(
          `Failed to parse content in both new and legacy formats for ${stateKey} in room ${roomId}`,
          {
            zlibError: zlibErrorMsg,
            legacyError: legacyErrorMsg,
            contentPreview: content.substring(0, 100),
          },
        );
        throw new Error(
          `Unable to parse state content in any supported format: ${legacyErrorMsg}`,
        );
      }
    }
  }

  private async migrateToNewFormat<C>(
    roomId: string,
    stateKey: string,
    data: C,
  ): Promise<void> {
    try {
      Logger.info(
        `Starting migration to new format for ${stateKey} in room ${roomId}`,
      );

      // Re-save using new compressed format
      await this.setState({
        roomId,
        stateKey,
        data,
      });

      Logger.info(
        `Successfully migrated ${stateKey} in room ${roomId} to new zlib format`,
      );
    } catch (error) {
      Logger.error(
        `Failed to migrate ${stateKey} in room ${roomId} to new format`,
        error,
      );
      // Don't throw here - migration failure shouldn't break the read operation
    }
  }

  async getState<C>(roomId: string, stateKey: string): Promise<C> {
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

    return this.parseContent<C>(content, roomId, stateKey);
  }

  async setState<C>(payload: IStatePayload<C>): Promise<void> {
    try {
      const str = stringify(payload.data);
      const compressed = deflateSync(Buffer.from(str, 'utf8'));
      const b64 = compressed.toString('base64');

      Logger.debug(
        `Setting state for ${payload.stateKey} in room ${payload.roomId} (compressed: ${str.length} -> ${b64.length} chars)`,
      );

      await this.client.sendStateEvent(
        payload.roomId,
        'ixo.room.state' as keyof sdk.StateEvents,
        { data: b64 } as sdk.StateEvents[keyof sdk.StateEvents],
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
    } catch {
      oldState = undefined;
    }

    const newState = oldState ? { ...oldState, ...payload.data } : payload.data;
    await this.setState({ ...payload, data: newState });
    return newState;
  }

  async listStateEvents<D>(room: sdk.Room): Promise<D[]> {
    const data: D[] = [];
    let migratedCount = 0;
    let totalProcessed = 0;

    Logger.info(`Starting to list state events for room ${room.roomId}`);

    // Start paginating backward.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition -- we need to paginate the timeline
    while (true) {
      // `client.scrollback` will paginate more events into the timeline.
      // eslint-disable-next-line no-await-in-loop -- we need to paginate the timeline
      await this.client.scrollback(room, 100); // The second argument is the number of events to load.

      // After the scrollback, check if we're at the start of the timeline.
      const timeline = room.getLiveTimeline();
      if (!timeline.getPaginationToken(sdk.Direction.Backward)) break;

      for (const event of timeline.getEvents()) {
        const content = event.getContent<{ data: string }>().data;
        if (content) {
          totalProcessed++;
          try {
            // Try new format first
            try {
              const compressed = Buffer.from(content, 'base64');
              const jsonBuf = inflateSync(compressed);
              const str = jsonBuf.toString('utf8');
              data.push(parse(str));
            } catch (zlibError) {
              // Try legacy format
              Logger.info(
                `Event ${event.getId()} in room ${room.roomId} uses legacy format, migrating`,
              );
              const legacyData = parse(content);
              data.push(legacyData as D);
              migratedCount++;

              // Note: We can't easily re-save timeline events as they're historical
              // This migration only applies to state events via getState()
            }
          } catch (err) {
            Logger.error(
              `Error parsing event ${event.getId()} in room ${room.roomId}`,
              err,
            );
          }
        }
      }
    }

    Logger.info(
      `Completed listing state events for room ${room.roomId}: ${totalProcessed} processed, ${migratedCount} legacy format detected`,
    );
    Logger.info(`Started migrating ${migratedCount} events to new format`);
    await this.migrateToNewFormat(room.roomId, 'ixo.room.state', data);
    Logger.info(`Completed migrating ${migratedCount} events to new format`);

    return data;
  }
}
