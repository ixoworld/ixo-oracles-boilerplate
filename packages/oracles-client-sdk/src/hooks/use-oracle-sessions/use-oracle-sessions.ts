import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useOraclesConfig } from '../use-oracles-config.js';
import { type IChatSession } from './types.js';

export const useOracleSessions = (
  oracleDid: string,
  overrides?: {
    baseUrl?: string;
  },
) => {
  const queryClient = useQueryClient();
  const { wallet, authedRequest } = useOraclesContext();

  if (!wallet) {
    throw new Error(
      'Wallet not found please add a wallet to the OraclesProvider',
    );
  }

  const { config } = useOraclesConfig(oracleDid);

  const apiUrl = overrides?.baseUrl ?? config.apiUrl ?? '';

  const { data, isLoading, error, refetch } = useQuery<{
    sessions: IChatSession[];
  }>({
    queryKey: ['oracle-sessions', wallet.address, oracleDid],
    queryFn: () =>
      authedRequest<{ sessions: IChatSession[] }>(`${apiUrl}/sessions`, 'GET'),
    enabled: Boolean(overrides?.baseUrl ?? config.apiUrl),
  });

  const {
    mutateAsync: createSession,
    isPending: isCreatingSession,
    isError: isCreateSessionError,
  } = useMutation({
    mutationFn: () => authedRequest<IChatSession>(`${apiUrl}/sessions`, 'POST'),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['oracle-sessions', wallet.address, oracleDid],
      });
    },
  });

  const {
    mutateAsync: deleteSession,
    isPending: isDeletingSession,
    isError: isDeleteSessionError,
  } = useMutation({
    mutationFn: (sessionId: string) =>
      authedRequest<void>(`${apiUrl}/sessions/${sessionId}`, 'DELETE'),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['oracle-sessions', wallet.address, oracleDid],
      });
    },
  });

  return {
    sessions: data?.sessions,
    isLoading,
    error,
    createSession,
    isCreatingSession,
    isCreateSessionError,
    deleteSession,
    isDeletingSession,
    isDeleteSessionError,
    refetch,
  };
};
