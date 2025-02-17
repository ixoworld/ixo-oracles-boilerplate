import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOraclesContext } from '../oracles-provider';
import {
  createSession,
  deleteSession,
  listSessions,
  updateSessionTitle,
} from './api';
import type { IListSessionsResponse } from './types';

// using a custom query key to avoid collisions with other queries and to calculate the query key the same way in other places
export const getSessionsQueryKey = ({ did }: { did: string }) =>
  ['sessions', did] as const;

export function useSessions(): UseQueryResult<IListSessionsResponse> {
  const { apiUrl, apiKey, config } = useOraclesContext();
  const { did, matrixAccessToken } = config;

  return useQuery({
    queryKey: getSessionsQueryKey({ did }),
    queryFn: () =>
      listSessions({
        apiUrl,
        apiKey,
        did,
        matrixAccessToken,
      }),
  });
}

export function useCreateSession() {
  const { apiUrl, apiKey, config } = useOraclesContext();
  const { did, matrixAccessToken } = config;
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: () =>
      createSession({
        apiUrl,
        apiKey,
        did,
        matrixAccessToken,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getSessionsQueryKey({ did }),
      });
    },
  });

  return {
    createSession: mutateAsync,
    isLoading: isPending,
    error,
  };
}

export function useDeleteSession() {
  const { apiUrl, apiKey, config } = useOraclesContext();
  const { did, matrixAccessToken } = config;
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      deleteSession({
        apiUrl,
        apiKey,
        did,
        matrixAccessToken,
        sessionId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getSessionsQueryKey({ did }),
      });
    },
  });

  return {
    deleteSession: mutateAsync,
    isLoading: isPending,
    error,
  };
}

export function useUpdateSessionTitle() {
  const { apiUrl, apiKey, config } = useOraclesContext();
  const { did, matrixAccessToken } = config;
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      updateSessionTitle({
        apiUrl,
        apiKey,
        sessionId,
        matrixAccessToken,
        title,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getSessionsQueryKey({ did }),
      });
    },
  });

  return {
    updateSessionTitle: mutateAsync,
    isLoading: isPending,
    error,
  };
}
