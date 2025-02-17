export interface IChatSession {
  sessionId: string;
  oracleName: string;
  title: string;
  lastUpdatedAt: string;
  createdAt: string;
}

export interface IListSessionsResponse {
  sessions: IChatSession[];
}

export type CreateSessionResponse = IChatSession;
