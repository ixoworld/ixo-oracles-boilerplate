'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { useGetOpenIdToken } from '../../hooks/index.js';
import { request } from '../../utils/request.js';
import {
  type IOraclesContextProps,
  type IOraclesProviderProps,
} from './types.js';

const OraclesContext = createContext<IOraclesContextProps | undefined>(
  undefined,
);

export const useOraclesContext = () => {
  const context = useContext(OraclesContext);
  if (context === undefined) {
    throw new Error('useOraclesContext must be used within a OraclesProvider');
  }
  return context;
};

export const OraclesProvider = ({
  children,
  initialWallet,
  transactSignX,
}: PropsWithChildren<IOraclesProviderProps>) => {
  if ((!initialWallet as unknown) || (!transactSignX as unknown)) {
    throw new Error('initialWallet and transactSignX are required');
  }

  const {
    openIdToken: openIdTokenFromHook,
    isLoading: isTokenLoading,
    error: tokenError,
    refetch,
  } = useGetOpenIdToken(initialWallet);

  const authedRequest = useCallback(
    async (
      url: string,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      options?: RequestInit,
    ) => {
      // Get fresh or cached token from React Query
      let openIdToken = openIdTokenFromHook?.access_token;

      // If no token available or there's an error, refetch
      if (!openIdToken || tokenError) {
        const { data: token } = await refetch();
        openIdToken = token?.access_token;

        if (!openIdToken) {
          const errorMessage = tokenError?.message || 'Unknown error';
          throw new Error(`Failed to get openIdToken: ${errorMessage}`);
        }
      }

      return request(url, method, {
        ...options,
        headers: {
          ...options?.headers,
          'x-did': initialWallet.did,
          'x-matrix-access-token': openIdToken,
        },
      });
    },
    [initialWallet.did, openIdTokenFromHook, refetch, tokenError],
  );

  const value: IOraclesContextProps = useMemo(
    () => ({
      wallet: initialWallet,
      transactSignX,
      authedRequest: authedRequest as <T>(
        url: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        options?: RequestInit,
      ) => Promise<T>,
    }),
    [initialWallet, transactSignX, authedRequest],
  );

  const queryClient = new QueryClient();
  return (
    <OraclesContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </OraclesContext.Provider>
  );
};
