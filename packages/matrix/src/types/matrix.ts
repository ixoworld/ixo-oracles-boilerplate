export interface IRoomCreationOptions {
  name: string;
  alias: string;
}

export interface IMessageOptions {
  roomId: string;
  message: string;
  isOracleAdmin?: boolean;
  threadId?: string;
}

export interface ICreateRoomOptions {
  did: string;
  oracleName: string;
}
