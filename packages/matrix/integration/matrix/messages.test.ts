import type * as sdk from 'matrix-js-sdk';
import { type RoomMessageEventContent } from 'matrix-js-sdk/lib/types';
import { MatrixManager } from 'src/matrix-manager';
import {
  type CleanupFunction,
  createRoomForUser,
  createTestUser,
  prepareTest,
} from '../test-utils';
import { InMemoryJsonStorage } from '../test-utils/in-memory-storage';

import { logger } from 'matrix-js-sdk/lib/logger';
import { formatMsg } from 'src/utils/format-msg';

const getMessageEvents = (room: sdk.Room): RoomMessageEventContent[] => {
  const evs = room.getLiveTimeline().getEvents();

  const msgEvents = evs.filter((ev) => ev.getType() === 'm.room.message');
  return msgEvents.map((ev) => ev.getContent());
};

describe('Matrix Manager Integration Tests -- Messages', () => {
  const manager = MatrixManager.getInstance();
  let testUser: { userId: string; accessToken: string; deviceId: string };
  let testRoom: sdk.Room;
  let cleanup: CleanupFunction;

  beforeAll(async () => {
    logger.disableAll();

    jest.mock('src/local-storage/local-storage', () => ({
      default: InMemoryJsonStorage,
      LocalJsonStorage: InMemoryJsonStorage,
    }));
    cleanup = await prepareTest(manager);
    testUser = await createTestUser(
      Math.random().toString(36).substring(2, 15),
    );
    const { roomId } = await createRoomForUser(manager, testUser, 'guru');
    const r = manager.getRoom(roomId);
    if (!r) {
      throw new Error('Room not found');
    }
    testRoom = r;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('should send a message to a room', async () => {
    const message = 'Hello, world!';

    const prevMessages = getMessageEvents(testRoom).length;
    await manager.sendMessage({
      roomId: testRoom.roomId,
      message,
      isOracleAdmin: false,
    });

    let messages = getMessageEvents(testRoom);

    expect(messages).toBeDefined();
    expect(messages).toHaveLength(prevMessages + 1);
    expect(messages[0]?.body).toBe(formatMsg(message, false));

    // as oracle
    const oracleMessage = 'I am oracle';
    await manager.sendMessage({
      roomId: testRoom.roomId,
      message: oracleMessage,
      isOracleAdmin: true,
    });

    messages = getMessageEvents(testRoom);
    expect(messages).toHaveLength(prevMessages + 2);
    expect(messages[1]?.body).toBe(formatMsg(oracleMessage, true));
  });

  it('should have encrypted messages', async () => {
    const message = 'Hello, world!';
    await manager.sendMessage({
      roomId: testRoom.roomId,
      message,
      isOracleAdmin: false,
    });

    const evs = testRoom.getLiveTimeline().getEvents();

    const msgEvents = evs.filter((ev) => ev.getType() === 'm.room.message');
    expect(msgEvents.every((ev) => ev.isEncrypted())).toBe(true);
  });
});
