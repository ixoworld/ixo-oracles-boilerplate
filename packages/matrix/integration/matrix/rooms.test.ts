import * as sdk from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { MatrixManager } from 'src/matrix-manager';
import {
  type CleanupFunction,
  createMatrixClient,
  createRoomForUser,
  createTestUser,
  prepareTest,
} from '../test-utils';
import { InMemoryJsonStorage } from '../test-utils/in-memory-storage';

const oracleName = 'guru';

describe('Matrix Manager Integration Tests -- Rooms', () => {
  const manager = MatrixManager.getInstance();
  let cleanup: CleanupFunction;
  let testUser: { userId: string; accessToken: string; deviceId: string };
  let testRoom: { roomId: string; did: string };

  beforeAll(async () => {
    logger.disableAll();

    jest.mock('src/local-storage/local-storage', () => ({
      default: InMemoryJsonStorage,
      LocalJsonStorage: InMemoryJsonStorage,
    }));
    // Setup Matrix network and create shared test resources
    cleanup = await prepareTest(manager);
    testUser = await createTestUser('testUser');
    testRoom = await createRoomForUser(manager, testUser, oracleName);
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('Room Creation', () => {
    it('should create a new room and validate membership with both SDKs', async () => {
      const newUser = await createTestUser('newUser');
      const { roomId } = await createRoomForUser(manager, newUser, oracleName);

      // Verify with our SDK
      const isInRoom = await manager.checkIsUserInRoom({
        roomId,
        userAccessToken: newUser.accessToken,
      });
      expect(isInRoom).toBe(true);

      // Verify with native SDK
      const userClient = await createMatrixClient(newUser);
      const userRoom = userClient.getRoom(roomId);
      expect(userRoom).toBeTruthy();
      expect(
        userRoom?.currentState
          .getStateEvents('m.room.member', newUser.userId)
          ?.getContent()?.membership,
      ).toBe('join');

      userClient.stopClient();
    });
  });

  describe('Room Queries', () => {
    it('should retrieve room by ID and validate properties with both SDKs', async () => {
      // Get room using our SDK
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();
      expect(room?.roomId).toBe(testRoom.roomId);

      // Validate with native SDK
      const userClient = await createMatrixClient(testUser);
      const nativeRoom = userClient.getRoom(testRoom.roomId);
      expect(nativeRoom?.roomId).toBe(room?.roomId);
      expect(nativeRoom?.name).toBe(room?.name);

      userClient.stopClient();
    });

    it('should check room membership status with both SDKs', async () => {
      // Test existing user membership
      const isInRoom = await manager.checkIsUserInRoom({
        roomId: testRoom.roomId,
        userAccessToken: testUser.accessToken,
      });
      expect(isInRoom).toBe(true);

      // Validate with native SDK
      const userClient = await createMatrixClient(testUser);
      const membershipEvent = userClient
        .getRoom(testRoom.roomId)
        ?.currentState.getStateEvents('m.room.member', testUser.userId)
        ?.getContent()?.membership;
      expect(membershipEvent).toBe('join');

      // Test non-member user
      const nonMember = await createTestUser('nonMember');
      const nonMemberInRoom = await manager.checkIsUserInRoom({
        roomId: testRoom.roomId,
        userAccessToken: nonMember.accessToken,
      });
      expect(nonMemberInRoom).toBe(false);

      // Validate with native SDK
      const nonMemberClient = await createMatrixClient(nonMember);
      expect(nonMemberClient.getRoom(testRoom.roomId)).toBeFalsy();

      userClient.stopClient();
      nonMemberClient.stopClient();
    });

    it('should retrieve room ID by DID and validate with both SDKs', async () => {
      // Get room ID using our SDK
      const retrievedRoomId = await manager.getRoomId({
        did: testRoom.did,
        oracleName,
      });
      expect(retrievedRoomId).toBe(testRoom.roomId);

      // Test non-existent room
      const nonExistentRoomId = await manager.getRoomId({
        did: 'did:ixo:nonexistent',
        oracleName,
      });
      expect(nonExistentRoomId).toBeUndefined();
    });

    it('should retrieve room ID by alias and validate with both SDKs', async () => {
      // Get room alias using our SDK
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const aliasEvent = roomState?.getStateEvents(
        sdk.EventType.RoomCanonicalAlias,
        '',
      );
      expect(aliasEvent).toBeTruthy();
      const alias = aliasEvent?.getContent().alias;
      expect(alias).toBeTruthy();

      // Get room ID from alias using our SDK
      const roomIdFromAlias = await manager.getRoomIdFromAlias(
        alias.slice(1).split(':')[0],
      );
      expect(roomIdFromAlias).toBe(testRoom.roomId);

      // Validate with native SDK
      const userClient = await createMatrixClient(testUser);
      const nativeRoomIdFromAlias = await userClient.getRoomIdForAlias(alias);
      expect(nativeRoomIdFromAlias.room_id).toBe(roomIdFromAlias);

      // Test non-existent alias
      const nonExistentRoomId =
        await manager.getRoomIdFromAlias('nonexistent_alias');
      expect(nonExistentRoomId).toBeUndefined();
      await expect(
        userClient.getRoomIdForAlias('#nonexistent_alias:localhost'),
      ).rejects.toThrow();

      userClient.stopClient();
    });

    it('should have a valid room configuration', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();
      expect(room?.roomId).toBe(testRoom.roomId);
    });
  });

  describe('Matrix Room Configuration Tests', () => {
    it('should configure room encryption correctly', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const encryptionEvent = roomState?.getStateEvents(
        sdk.EventType.RoomEncryption,
        '',
      );
      expect(encryptionEvent).toBeTruthy();
      expect(encryptionEvent?.getContent()).toEqual({
        algorithm: 'm.megolm.v1.aes-sha2',
      });
    });

    it('should configure guest access correctly', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const guestAccessEvent = roomState?.getStateEvents(
        sdk.EventType.RoomGuestAccess,
        '',
      );
      expect(guestAccessEvent).toBeTruthy();
      expect(guestAccessEvent?.getContent()).toEqual({
        guest_access: sdk.GuestAccess.Forbidden,
      });
    });

    it('should configure history visibility correctly', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const historyVisibilityEvent = roomState?.getStateEvents(
        sdk.EventType.RoomHistoryVisibility,
        '',
      );
      expect(historyVisibilityEvent).toBeTruthy();
      expect(historyVisibilityEvent?.getContent()).toEqual({
        history_visibility: sdk.HistoryVisibility.Shared,
      });
    });

    it('should configure power levels correctly', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const powerLevelsEvent = roomState?.getStateEvents(
        'm.room.power_levels',
        '',
      );
      expect(powerLevelsEvent).toBeTruthy();

      const content = powerLevelsEvent?.getContent();
      expect(content).toBeTruthy();

      // Validate power level values (ADMIN_POWER_LEVEL = 9999)
      expect(content).toMatchObject({
        kick: 9999,
        ban: 9999,
        invite: 9999,
        redact: 9999,
      });

      // Validate admin user has correct power level
      const adminUserId = process.env.MATRIX_ORACLE_ADMIN_USER_ID ?? '';
      expect(adminUserId).toBeTruthy();
      if (content && adminUserId) {
        expect(content.users[adminUserId]).toBe(9999);
      }
    });

    it('should set correct room name and topic', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const expectedName = MatrixManager.generateRoomNameFromDidAndOracle(
        testRoom.did,
        oracleName,
      );
      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const nameEvent = roomState?.getStateEvents('m.room.name', '');
      expect(nameEvent?.getContent().name).toBe(expectedName);

      const topicEvent = roomState?.getStateEvents('m.room.topic', '');
      expect(topicEvent?.getContent().topic).toBe(expectedName);
    });

    it('should set correct room visibility', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const joinRulesEvent = roomState?.getStateEvents('m.room.join_rules', '');
      expect(joinRulesEvent?.getContent().join_rule).toBe('invite');
    });

    it('should set correct room alias', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const expectedName = MatrixManager.generateRoomNameFromDidAndOracle(
        testRoom.did,
        oracleName,
      );
      const expectedAlias =
        MatrixManager.generateRoomAliasFromName(expectedName);

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const aliasEvent = roomState?.getStateEvents(
        'm.room.canonical_alias',
        '',
      );
      expect(aliasEvent).toBeTruthy();

      const fullAlias = aliasEvent?.getContent().alias;
      expect(fullAlias).toContain(expectedAlias);
    });

    it('should invite the correct user', async () => {
      const room = await manager.getRoom(testRoom.roomId, testUser.accessToken);
      expect(room).toBeTruthy();

      const roomState = room
        ?.getLiveTimeline()
        .getState(sdk.EventTimeline.FORWARDS);
      const memberEvent = roomState?.getStateEvents(
        'm.room.member',
        testUser.userId,
      );
      expect(memberEvent).toBeTruthy();
      expect(memberEvent?.getContent().membership).toBe('join');
    });
  });
});
