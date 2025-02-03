export enum SessionManagerErrorCodes {
  NO_USER_ROOMS_FOUND = 'NO_USER_ROOMS_FOUND',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  USER_NOT_IN_ROOM = 'USER_NOT_IN_ROOM',
}

export class SessionManagerError extends Error {
  constructor(
    message: string,
    public readonly code: SessionManagerErrorCodes,
  ) {
    super(message);
  }
}

export class NoUserRoomsFoundError extends SessionManagerError {
  constructor(did: string) {
    super(
      `No user rooms found for the given did ${did}`,
      SessionManagerErrorCodes.NO_USER_ROOMS_FOUND,
    );
  }
  isNoUserRoomsFoundError(error: unknown): error is NoUserRoomsFoundError {
    return (
      error instanceof NoUserRoomsFoundError &&
      error.code === SessionManagerErrorCodes.NO_USER_ROOMS_FOUND
    );
  }
}

export class RoomNotFoundError extends SessionManagerError {
  constructor(roomId: string) {
    super(`Room ${roomId} not found`, SessionManagerErrorCodes.ROOM_NOT_FOUND);
  }
  isRoomNotFoundError(error: unknown): error is RoomNotFoundError {
    return (
      error instanceof RoomNotFoundError &&
      error.code === SessionManagerErrorCodes.ROOM_NOT_FOUND
    );
  }
}

export class UserNotInRoomError extends SessionManagerError {
  constructor(did: string, roomId: string) {
    super(
      `User ${did} not in room ${roomId}`,
      SessionManagerErrorCodes.USER_NOT_IN_ROOM,
    );
  }
  isUserNotInRoomError(error: unknown): error is UserNotInRoomError {
    return (
      error instanceof UserNotInRoomError &&
      error.code === SessionManagerErrorCodes.USER_NOT_IN_ROOM
    );
  }
}
