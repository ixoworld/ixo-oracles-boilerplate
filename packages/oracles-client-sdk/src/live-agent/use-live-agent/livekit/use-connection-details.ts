import { decodeJwt } from 'jose';
import { type IOpenIDToken } from 'matrix-js-sdk';
import { useCallback, useState } from 'react';

export type ConnectionDetails = {
  url: string;
  jwt: string;
};
const ONE_MINUTE_IN_MILLISECONDS = 60 * 1000;

const network = process.env.NEXT_PUBLIC_CHAIN_NETWORK as
  | 'devnet'
  | 'testnet'
  | 'mainnet';
const JWT_SERVER = {
  devnet: 'https://livekit-jwt.devmx.ixo.earth/sfu/get',
  testnet: 'https://livekit-jwt.testmx.ixo.earth/sfu/get',
  mainnet: 'https://livekit-jwt.mx.ixo.earth/sfu/get',
};

export default function useConnectionDetails() {
  const [connectionDetails, setConnectionDetails] =
    useState<ConnectionDetails | null>(null);

  const fetchConnectionDetails = useCallback(
    async (roomId: string, openIdToken: IOpenIDToken) => {
      setConnectionDetails(null);
      const url = process.env.NEXT_PUBLIC_JWT_SERVER ?? JWT_SERVER[network];

      let data: ConnectionDetails;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            room: roomId,
            openid_token: {
              access_token: openIdToken?.access_token,
              expires_in: 3600,
              matrix_server_name: openIdToken?.matrix_server_name,
              token_type: 'Bearer',
            },
            device_id: 'PORTAL',
          }),
        });
        data = await res.json();
      } catch (error) {
        console.error('Error fetching connection details:', error);
        throw new Error('Error fetching connection details!');
      }

      setConnectionDetails(data);
      return data;
    },
    [],
  );

  // useEffect(() => {
  //   fetchConnectionDetails();
  // }, [fetchConnectionDetails]);

  const isConnectionDetailsExpired = useCallback(() => {
    const token = connectionDetails?.jwt;
    if (!token) {
      return true;
    }

    const jwtPayload = decodeJwt(token);
    if (!jwtPayload.exp) {
      return true;
    }
    const expiresAt = new Date(jwtPayload.exp - ONE_MINUTE_IN_MILLISECONDS);

    const now = new Date();
    return expiresAt >= now;
  }, [connectionDetails?.jwt]);

  const existingOrRefreshConnectionDetails = useCallback(
    async (roomId: string, openIdToken: IOpenIDToken) => {
      if (isConnectionDetailsExpired() || !connectionDetails) {
        return fetchConnectionDetails(roomId, openIdToken);
      } else {
        return connectionDetails;
      }
    },
    [connectionDetails, fetchConnectionDetails, isConnectionDetailsExpired],
  );

  return {
    connectionDetails,
    refreshConnectionDetails: fetchConnectionDetails,
    existingOrRefreshConnectionDetails,
  };
}
