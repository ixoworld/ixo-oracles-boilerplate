export interface IRoomCreationOptions {
  name: string;
  alias: string;
  adminUserId: string;
  inviteUserId: string;
}

export interface IMessageOptions {
  roomId: string;
  message: string;
  isOracleAdmin?: boolean;
  threadId?: string;
}

export interface ICreateRoomAndJoinOptions {
  did: string;
  oracleName: string;
  userAccessToken: string;
}
