export const supportedOracles = ['guru', 'giza', 'oracleSessions'];

type LiteralUnion<LiteralType extends BaseType, BaseType extends string> =
  | LiteralType
  | (BaseType & Record<never, never>);

export type OraclesNamesOnMatrix = LiteralUnion<
  (typeof supportedOracles)[number],
  string
>;

export type OraclesCallMatrixEvent = {
  type: 'm.ixo.oracles_call';
  content: {
    sessionId: string;
    userDid: string;
    oracleDid: string;
    callType: 'audio' | 'video';
    callStatus: 'active' | 'ended' | 'pending';
    callStartedAt?: string;
    callEndedAt?: string;
    encryptionKey: string;
  };
};

export * from 'matrix-bot-sdk';
