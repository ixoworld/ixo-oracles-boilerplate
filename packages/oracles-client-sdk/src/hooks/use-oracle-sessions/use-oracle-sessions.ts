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
  const { authedRequest } = useOraclesContext();

  const { config, isReady: isConfigReady } = useOraclesConfig(
    oracleDid,
    overrides,
  );

  const getApiUrl = () => overrides?.baseUrl ?? config.apiUrl ?? '';

  const { data, isLoading, error, refetch } = useQuery<{
    sessions: IChatSession[];
  }>({
    queryKey: ['oracle-sessions', oracleDid],
    queryFn: () =>
      authedRequest<{ sessions: IChatSession[] }>(
        `${getApiUrl()}/sessions`,
        'GET',
        {},
      ),
    enabled: Boolean(overrides?.baseUrl ?? config.apiUrl),
    retry: false,
  });

  const {
    mutateAsync: createSession,
    isPending: isCreatingSession,
    isError: isCreateSessionError,
  } = useMutation({
    mutationFn: () => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error(
          'API URL is not ready. Please wait for oracle config to load.',
        );
      }
      return authedRequest<IChatSession>(`${apiUrl}/sessions`, 'POST', {});
    },
    onSettled: async () => {
      refetch();
    },
  });

  const {
    mutateAsync: deleteSession,
    isPending: isDeletingSession,
    isError: isDeleteSessionError,
  } = useMutation({
    mutationFn: (sessionId: string) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error(
          'API URL is not ready. Please wait for oracle config to load.',
        );
      }
      return authedRequest<void>(
        `${apiUrl}/sessions/${sessionId}`,
        'DELETE',
        {},
      );
    },
    onSettled: async () => {
      refetch();
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
    isConfigReady,
  };
};
