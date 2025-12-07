'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import { getOpenIdToken } from '../../hooks/index.js';
import { request } from '../../utils/request.js';
import {
  clearTokenCache,
  decryptAndRetrieve,
  encryptAndStore,
} from '../../utils/token-cache.js';
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

  // Clear token cache when wallet/DID changes
  useEffect(() => {
    try {
      // Check if cached token exists and if DID matches
      const cachedToken = localStorage.getItem('oracles_openid_token');
      if (cachedToken) {
        // Try to decrypt and check DID - if it doesn't match, clear it
        decryptAndRetrieve({
          did: initialWallet.did,
          matrixAccessToken: initialWallet.matrix.accessToken,
        }).catch(() => {
          // If decryption fails or DID doesn't match, clear the cache
          clearTokenCache();
          console.debug(
            'Cleared token cache due to DID mismatch or decryption failure',
          );
        });
      }
    } catch (error) {
      console.warn('Failed to check cached token:', error);
      // Clear cache on any error
      clearTokenCache();
    }
  }, [initialWallet.did]);

  const authedRequest = useCallback(
    async (
      url: string,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      options?: RequestInit,
    ) => {
      const matrixAccessToken = initialWallet.matrix.accessToken;

      let openIdToken = undefined;
      // If no openIdToken provided, try to get from cache
      try {
        const cachedToken = await decryptAndRetrieve({
          did: initialWallet.did,
          matrixAccessToken,
        });
        if (cachedToken?.access_token) {
          openIdToken = cachedToken.access_token;
        }
      } catch (error) {
        console.warn('Failed to retrieve cached token:', error);
      }

      if (!openIdToken) {
        const token = await getOpenIdToken({
          userId: initialWallet.did,
          matrixAccessToken,
          did: initialWallet.did,
        });
        openIdToken = token.access_token;

        await encryptAndStore({
          token,
          matrixAccessToken,
          did: initialWallet.did,
        });
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
    [initialWallet],
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
