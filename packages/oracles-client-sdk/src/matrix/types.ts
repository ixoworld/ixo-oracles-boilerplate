type MatrixClientConstructorParams = {
  userAccessToken: string;
  appServiceBotUrl?: string;
  homeserverUrl?: string;
};

type SourceSpacePayload = {
  userDID: string;
};

type JoinSpaceOrRoomPayload = {
  roomId: string;
};

type CreateAndJoinOracleRoomPayload = {
  oracleDID: string;
  userDID: string;
};

export type {
  MatrixClientConstructorParams,
  SourceSpacePayload,
  JoinSpaceOrRoomPayload,
  CreateAndJoinOracleRoomPayload,
};
