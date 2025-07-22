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

type MatrixRoomMember = {
  type: string;
  room_id: string;
  sender: string;
  content: {
    displayname?: string;
    membership: 'join' | 'leave' | 'invite' | 'ban';
  };
  state_key: string;
  origin_server_ts: number;
  unsigned?: {
    replaces_state?: string;
    age?: number;
  };
  event_id: string;
  user_id: string;
  age?: number;
  replaces_state?: string;
};

type MatrixRoomMembersResponse = {
  chunk: MatrixRoomMember[];
};

type MatrixPowerLevels = {
  users: Record<string, number>;
};

export type {
  CreateAndJoinOracleRoomPayload,
  JoinSpaceOrRoomPayload,
  MatrixClientConstructorParams,
  MatrixPowerLevels,
  MatrixRoomMember,
  MatrixRoomMembersResponse,
  SourceSpacePayload,
};
