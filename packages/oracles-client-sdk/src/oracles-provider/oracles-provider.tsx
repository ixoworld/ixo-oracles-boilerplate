import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSocket, useSocketEvent } from 'socket.io-react-hook';
import { OraclesContext } from './oracles-context';
import { SocketProvider } from './socket-provider';
import { type OraclesProviderProps } from './types';

const queryClient = new QueryClient();

const Provider = ({
  children,
  apiUrl,
  apiKey,
  config,
  overrideQueryClient,
}: OraclesProviderProps): JSX.Element => {
  if (!apiUrl || !apiKey || !config.did || !config.matrixAccessToken) {
    throw new Error(
      'Please provide apiUrl, apiKey, and config to the OraclesProvider',
    );
  }
  const [connectionId, setConnectionId] = useState<string | undefined>(
    undefined,
  );
  const { socket } = useSocket(apiUrl, {
    transports: ['websocket'],
    query: {
      token: apiKey,
    },
    enabled: Boolean(apiKey),
  });

  useSocketEvent<string>(socket, 'connection', {
    onMessage: (id) => {
      setConnectionId(id);
    },
  });

  const contextValue = useMemo(
    () => ({
      apiUrl,
      apiKey,
      config,
      connectionId,
      socket,
    }),
    [apiUrl, apiKey, config, connectionId, socket],
  );

  return (
    <OraclesContext.Provider value={contextValue}>
      <QueryClientProvider client={overrideQueryClient ?? queryClient}>
        {children}
      </QueryClientProvider>
    </OraclesContext.Provider>
  );
};

export function OraclesProvider(props: OraclesProviderProps): JSX.Element {
  return (
    <SocketProvider>
      <Provider {...props} />
    </SocketProvider>
  );
}
