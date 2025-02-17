import { type QueryClient } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { type useSocket } from 'socket.io-react-hook';

type OraclesContextConfig = {
  did: string;
  matrixAccessToken: string;
};

interface IOraclesContextValue {
  apiUrl: string;
  apiKey: string;
  config: OraclesContextConfig;
  connectionId: string | undefined;
  socket: Socket;
}

type Socket = ReturnType<typeof useSocket>['socket'];
type OraclesProviderProps = {
  children: ReactNode;
  apiUrl: string;
  apiKey: string;
  config: Omit<OraclesContextConfig, 'connectionId' | 'socket'>;

  overrideQueryClient?: QueryClient;
};
export type {
  IOraclesContextValue,
  OraclesContextConfig,
  OraclesProviderProps,
  Socket,
};
