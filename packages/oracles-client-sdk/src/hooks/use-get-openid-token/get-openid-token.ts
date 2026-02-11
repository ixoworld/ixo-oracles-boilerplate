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

  const openIdToken = await matrixClient.getOpenIdTokenWithDid(userId, did);
  return openIdToken;
};
