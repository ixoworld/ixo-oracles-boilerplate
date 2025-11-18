'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useGetOpenIdToken } from '../../hooks/index.js';
import { request } from '../../utils/request.js';
import type { AgAction } from '../../hooks/use-ag-action.js';
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

const OraclesProviderInner = ({
  children,
  initialWallet,
  transactSignX,
}: PropsWithChildren<IOraclesProviderProps>) => {
  const {
    openIdToken: openIdTokenFromHook,
    isLoading: isTokenLoading,
    error: tokenError,
    refetch,
  } = useGetOpenIdToken(initialWallet);

  // AG-UI action state management
  const [agActions, setAgActions] = useState<AgAction[]>([]);
  const agActionHandlers = useRef<
    Map<string, (args: any) => Promise<any> | any>
  >(new Map());
  const agActionRenders = useRef<
    Map<string, (props: any) => React.ReactElement | null>
  >(new Map());

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

  // AG-UI action management functions
  const registerAgAction = useCallback(
    (
      action: AgAction,
      handler: (args: any) => Promise<any> | any,
      render?: (props: any) => React.ReactElement | null,
    ) => {
      setAgActions((prev) => {
        // Check if action already exists
        const exists = prev.some((a) => a.name === action.name);
        if (exists) {
          // Update existing action
          return prev.map((a) => (a.name === action.name ? action : a));
        }
        // Add new action
        return [...prev, action];
      });

      agActionHandlers.current.set(action.name, handler);
      if (render) {
        agActionRenders.current.set(action.name, render);
      }
    },
    [],
  );

  const unregisterAgAction = useCallback((name: string) => {
    setAgActions((prev) => prev.filter((a) => a.name !== name));
    agActionHandlers.current.delete(name);
    agActionRenders.current.delete(name);
  }, []);

  const executeAgAction = useCallback(async (name: string, args: any) => {
    const handler = agActionHandlers.current.get(name);
    if (!handler) {
      throw new Error(`AG-UI action '${name}' not found`);
    }
    return await handler(args);
  }, []);

  const getAgActionRender = useCallback((name: string) => {
    return agActionRenders.current.get(name);
  }, []);

  const value: IOraclesContextProps = useMemo(
    () => ({
      wallet: initialWallet,
      transactSignX,
      authedRequest: authedRequest as <T>(
        url: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        options?: RequestInit,
      ) => Promise<T>,
      agActions,
      registerAgAction,
      unregisterAgAction,
      executeAgAction,
      getAgActionRender,
    }),
    [
      initialWallet,
      transactSignX,
      authedRequest,
      agActions,
      registerAgAction,
      unregisterAgAction,
      executeAgAction,
      getAgActionRender,
    ],
  );

  return (
    <OraclesContext.Provider value={value}>{children}</OraclesContext.Provider>
  );
};

// Outer component that sets up QueryClient
export const OraclesProvider = ({
  children,
  initialWallet,
  transactSignX,
}: PropsWithChildren<IOraclesProviderProps>) => {
  if ((!initialWallet as unknown) || (!transactSignX as unknown)) {
    throw new Error('initialWallet and transactSignX are required');
  }

  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <OraclesProviderInner
        initialWallet={initialWallet}
        transactSignX={transactSignX}
      >
        {children}
      </OraclesProviderInner>
    </QueryClientProvider>
  );
};
