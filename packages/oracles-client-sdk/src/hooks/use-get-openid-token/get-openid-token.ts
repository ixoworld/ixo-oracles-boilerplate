import MatrixClient from '../../matrix/matrix-client.js';

type GetOpenIdTokenParams = {
  userId: string;
  matrixAccessToken: string;
};
export const getOpenIdToken = async ({
  userId,
  matrixAccessToken,
}: GetOpenIdTokenParams) => {
  const matrixClient = new MatrixClient({
    userAccessToken: matrixAccessToken,
  });

  const openIdToken = await matrixClient.getOpenIdToken(userId);
  return openIdToken;
};
