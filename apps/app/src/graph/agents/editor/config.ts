export interface MatrixRoomById {
  type: 'id';
  value: string;
}

export interface MatrixRoomByAlias {
  type: 'alias';
  value: string;
}

export type MatrixRoomConfig = MatrixRoomById | MatrixRoomByAlias;

export interface MatrixConfig {
  baseUrl: string;
  accessToken: string;
  userId: string;
  room: MatrixRoomConfig;
  initialSyncTimeoutMs: number;
}

export interface ProviderConfig {
  docName: string;
  enableAwareness: boolean;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface BlockNoteConfig {
  defaultBlockId?: string;
  blockNamespace?: string;
  mutableAttributeKeys: string[];
}

export interface AppConfig {
  matrix: MatrixConfig;
  provider: ProviderConfig;
  blocknote: BlockNoteConfig;
}
