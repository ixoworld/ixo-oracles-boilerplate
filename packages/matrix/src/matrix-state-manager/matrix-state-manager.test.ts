import type * as sdk from 'matrix-js-sdk';
import { stringify } from 'superjson';
import { MatrixStateManager } from './matrix-state-manager';

const mockEventResponse: sdk.ISendEventResponse = {
  event_id: 'test_event_id',
};

jest.mock('@ixo/logger');
jest.mock('matrix-js-sdk');

jest.mock('../types', () => ({
  supportedOracles: ['weather'],
}));

const stateValue = { foo: 'bar' };
const stringifiedStateValue = stringify(stateValue);

const validRoomId = '!room:localhost';
const validStateKey = 'weather_key';

describe('MatrixStateManager', () => {
  let matrixStateManager: MatrixStateManager;
  let mockMatrixClient: jest.Mocked<sdk.MatrixClient>;

  beforeEach(() => {
    mockMatrixClient = {
      getStateEvent: jest.fn(),
      sendStateEvent: jest.fn().mockResolvedValue(mockEventResponse),
      scrollback: jest.fn(),
    } as unknown as jest.Mocked<sdk.MatrixClient>;

    matrixStateManager = new MatrixStateManager(mockMatrixClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getState', () => {
    it('should get state successfully', async () => {
      mockMatrixClient.getStateEvent.mockResolvedValue({
        data: stringifiedStateValue,
      });
      const result = await matrixStateManager.getState(
        validRoomId,
        validStateKey,
      );
      expect(mockMatrixClient.getStateEvent).toHaveBeenCalledWith(
        validRoomId,
        'ixo.room.state',
        validStateKey,
      );

      expect(result).toEqual(stateValue);
    });

    it('should throw an error if the room id is not valid', async () => {
      await expect(
        matrixStateManager.getState('invalid_room_id', validStateKey),
      ).rejects.toThrow('Invalid room ID: invalid_room_id');
    });

    it('should throw an error if the state key is not valid', async () => {
      await expect(
        //@ts-expect-error - we want to test the error
        matrixStateManager.getState(validRoomId, 'invalidStateKey'),
      ).rejects.toThrow('Invalid state key: invalidStateKey');
    });

    it('should throw an error if the content is not a string', async () => {
      mockMatrixClient.getStateEvent.mockResolvedValue({
        data: { foo: 'bar' },
      });
      await expect(
        matrixStateManager.getState(validRoomId, validStateKey),
      ).rejects.toThrow('Invalid content type: object');
    });

    it('should throw an error if the content is not valid JSON', async () => {
      mockMatrixClient.getStateEvent.mockResolvedValue({
        data: 'invalid_json',
      });
      await expect(
        matrixStateManager.getState(validRoomId, validStateKey),
      ).rejects.toThrow();
    });
  });

  describe('setState', () => {
    it('should set state successfully', async () => {
      await matrixStateManager.setState({
        roomId: validRoomId,
        stateKey: validStateKey,
        data: stateValue,
      });

      expect(mockMatrixClient.sendStateEvent).toHaveBeenCalledWith(
        validRoomId,
        'ixo.room.state',
        {
          data: stringifiedStateValue,
        },
        validStateKey,
      );
    });

    it('should throw an error if setting state fails', async () => {
      mockMatrixClient.sendStateEvent.mockRejectedValue(
        new Error('Failed to set state'),
      );

      await expect(
        matrixStateManager.setState({
          roomId: validRoomId,
          stateKey: validStateKey,
          data: stateValue,
        }),
      ).rejects.toThrow('Failed to set state');
    });
  });

  describe('updateState', () => {
    it('should update state with merged data when existing state exists', async () => {
      const existingState = { foo: 'bar', existing: true };
      const newState = { foo: 'baz', new: true };
      const expectedMergedState = { foo: 'baz', existing: true, new: true };

      mockMatrixClient.getStateEvent.mockResolvedValue({
        data: stringify(existingState),
      });

      await matrixStateManager.updateState({
        roomId: validRoomId,
        stateKey: validStateKey,
        data: newState,
      });

      expect(mockMatrixClient.sendStateEvent).toHaveBeenCalledWith(
        validRoomId,
        'ixo.room.state',
        {
          data: stringify(expectedMergedState),
        },
        validStateKey,
      );
    });

    it('should set new state when no existing state exists', async () => {
      mockMatrixClient.getStateEvent.mockRejectedValue(new Error('Not found'));
      const newState = { foo: 'baz', new: true };

      await matrixStateManager.updateState({
        roomId: validRoomId,
        stateKey: validStateKey,
        data: newState,
      });

      expect(mockMatrixClient.sendStateEvent).toHaveBeenCalledWith(
        validRoomId,
        'ixo.room.state',
        {
          data: stringify(newState),
        },
        validStateKey,
      );
    });
  });

  describe('listStateEvents', () => {
    it('should list and parse state events from room timeline', async () => {
      const mockRoom = {
        getLiveTimeline: jest.fn(),
      };
      const mockTimeline = {
        getPaginationToken: jest.fn(),
        getEvents: jest.fn(),
      };
      const mockEvent = {
        getContent: jest.fn(),
      };

      const eventData = { test: 'data' };
      const stringifiedEventData = stringify(eventData);

      mockRoom.getLiveTimeline.mockReturnValue(mockTimeline);
      mockTimeline.getPaginationToken
        .mockReturnValueOnce('token')
        .mockReturnValueOnce(null);
      mockTimeline.getEvents.mockReturnValue([mockEvent]);
      mockEvent.getContent.mockReturnValue({ data: stringifiedEventData });

      const result = await matrixStateManager.listStateEvents(
        mockRoom as unknown as sdk.Room,
      );

      expect(mockMatrixClient.scrollback).toHaveBeenCalledWith(mockRoom, 100);
      expect(result).toEqual([eventData]);
    });

    it('should handle invalid event content gracefully', async () => {
      const mockRoom = {
        getLiveTimeline: jest.fn(),
      };
      const mockTimeline = {
        getPaginationToken: jest.fn(),
        getEvents: jest.fn(),
      };
      const mockEvent = {
        getContent: jest.fn(),
      };

      mockRoom.getLiveTimeline.mockReturnValue(mockTimeline);
      mockTimeline.getPaginationToken.mockReturnValueOnce(null);
      mockTimeline.getEvents.mockReturnValue([mockEvent]);
      mockEvent.getContent.mockReturnValue({ data: 'invalid json' });

      const result = await matrixStateManager.listStateEvents(
        mockRoom as unknown as sdk.Room,
      );

      expect(result).toEqual([]);
    });
  });
});
