import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import MatrixClient from '../../matrix/matrix-client.js';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';

export const useGetOpenIdToken = () => {
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
        `@did-ixo-${wallet?.address}:${new URL(matrixClientRef.params.homeserverUrl ?? '').hostname}`,
        wallet.did,
      );
    },
    enabled: !!wallet?.did && !!wallet?.matrix.accessToken,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 5, // 5 minutes
  });

  return { openIdToken, isLoading, error };
};
