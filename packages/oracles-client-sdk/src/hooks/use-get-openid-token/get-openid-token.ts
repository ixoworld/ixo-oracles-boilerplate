import MatrixClient from '../../matrix/matrix-client.js';

type GetOpenIdTokenParams = {
  userId: string;
  matrixAccessToken: string;
  did: string;
};
export const getOpenIdToken = async ({
  userId,
  matrixAccessToken,
  did,
}: GetOpenIdTokenParams) => {
  if (!userId.startsWith('@')) {
    throw new Error('User ID must start with @');
  }
  const matrixClient = new MatrixClient({
    userAccessToken: matrixAccessToken,
  });

  const openIdToken = await matrixClient.getOpenIdToken(userId, did);
  return openIdToken;
};
