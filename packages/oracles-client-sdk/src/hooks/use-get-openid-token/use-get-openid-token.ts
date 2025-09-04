import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import MatrixClient from '../../matrix/matrix-client.js';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';

export const useGetOpenIdToken = (forceNewToken: boolean = false) => {
  const { wallet } = useOraclesContext();
  const matrixClientRef = useMemo(
    () =>
      new MatrixClient({
        userAccessToken: wallet?.matrix.accessToken ?? '',
      }),
    [wallet?.matrix.accessToken],
  );
  const {
    data: openIdToken,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['openIdToken', wallet?.did],
    queryFn: () => {
      if (!wallet?.did) {
        return;
      }
      return matrixClientRef.getOpenIdToken(
        // `${wallet?.did.replace(':', '-')}@${new URL(matrixClientRef.params.homeserverUrl ?? '').hostname}`,
        `@did-ixo-${wallet?.address}:${new URL(matrixClientRef.params.homeserverUrl ?? '').hostname}`,
        forceNewToken,
      );
    },
    enabled: !!wallet?.did && !!wallet?.matrix.accessToken,
    staleTime: forceNewToken ? 0 : 1000 * 60 * 5, // 5 minutes
    gcTime: forceNewToken ? 0 : 1000 * 60 * 5, // 5 minutes
  });

  return { openIdToken, isLoading, error };
};
