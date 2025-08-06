import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import MatrixClient from '../../matrix/matrix-client.js';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';

export const useGetOpenIdToken = (
  userId: string,
  forceNewToken: boolean = false,
) => {
  const { wallet } = useOraclesContext();
  const matrixClientRef = useMemo(
    () =>
      new MatrixClient({
        userAccessToken: wallet?.matrix.accessToken ?? '',
      }),
    [wallet?.matrix.accessToken],
  );

  const { data: openIdToken } = useQuery({
    queryKey: ['openIdToken', userId],
    queryFn: () => matrixClientRef.getOpenIdToken(userId, forceNewToken),
    enabled: !!userId,
    staleTime: forceNewToken ? 0 : 1000 * 60 * 5, // 5 minutes
    gcTime: forceNewToken ? 0 : 1000 * 60 * 5, // 5 minutes
  });

  return openIdToken;
};
