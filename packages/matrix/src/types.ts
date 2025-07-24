export interface IMatrixManagerInitConfig {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}
export const supportedOracles = ['guru', 'giza', 'oracleSessions'];

type LiteralUnion<LiteralType extends BaseType, BaseType extends string> =
  | LiteralType
  | (BaseType & Record<never, never>);

export type OraclesNamesOnMatrix = LiteralUnion<
  (typeof supportedOracles)[number],
  string
>;

export * from 'matrix-bot-sdk';
