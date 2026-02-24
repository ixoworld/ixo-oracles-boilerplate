export class DeleteSessionDto {
  did: string;
  matrixAccessToken: string;
  sessionId: string;
  homeServer?: string;
  userToken?: string;
}
