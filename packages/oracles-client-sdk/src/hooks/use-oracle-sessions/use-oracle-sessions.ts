import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useGetOpenIdToken } from '../use-get-openid-token/use-get-openid-token.js';
import { useOraclesConfig } from '../use-oracles-config.js';
import { type IChatSession } from './types.js';

export const useOracleSessions = (
  oracleDid: string,
  overrides?: {
    baseUrl?: string;
  },
) => {
  const queryClient = useQueryClient();
  const { openIdToken } = useGetOpenIdToken();
  const { authedRequest } = useOraclesContext();

  const { config } = useOraclesConfig(oracleDid);

  const apiUrl = overrides?.baseUrl ?? config.apiUrl ?? '';

  const { data, isLoading, error, refetch } = useQuery<{
    sessions: IChatSession[];
  }>({
    queryKey: ['oracle-sessions', oracleDid],
    queryFn: () =>
      authedRequest<{ sessions: IChatSession[] }>(`${apiUrl}/sessions`, 'GET', {
        openIdToken: openIdToken?.access_token,
      }),
    enabled: Boolean(
      (overrides?.baseUrl ?? config.apiUrl) && openIdToken?.access_token,
    ),
    retry: false,
  });

  const {
    mutateAsync: createSession,
    isPending: isCreatingSession,
    isError: isCreateSessionError,
  } = useMutation({
    mutationFn: () =>
      authedRequest<IChatSession>(`${apiUrl}/sessions`, 'POST', {
        openIdToken: openIdToken?.access_token,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['oracle-sessions', oracleDid],
      });
    },
  });

  const {
    mutateAsync: deleteSession,
    isPending: isDeletingSession,
    isError: isDeleteSessionError,
  } = useMutation({
    mutationFn: (sessionId: string) =>
      authedRequest<void>(`${apiUrl}/sessions/${sessionId}`, 'DELETE', {
        openIdToken: openIdToken?.access_token,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['oracle-sessions', oracleDid],
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
