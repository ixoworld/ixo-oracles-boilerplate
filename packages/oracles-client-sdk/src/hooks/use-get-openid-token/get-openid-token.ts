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
  const matrixClient = new MatrixClient({
    userAccessToken: matrixAccessToken,
  });

  if (!userId) {
    throw new Error('User ID is required');
  }
  if (!did) {
    throw new Error('DID is required');
  }
  if (!matrixAccessToken) {
    throw new Error('Matrix access token is required');
  }
  if (!matrixClient.params.homeserverUrl) {
    throw new Error('Homeserver URL is required');
  }

  if (!userId.startsWith('@did-ixo-')) {
    throw new Error('User ID must start with @did-ixo-');
  }

  const openIdToken = await matrixClient.getOpenIdToken(userId, did, false);
  return openIdToken;
};
