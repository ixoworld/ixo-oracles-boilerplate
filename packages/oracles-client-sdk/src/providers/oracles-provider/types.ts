import type { TransactionFn } from '@ixo/oracles-chain-client/react';
import type { AgAction } from '../../hooks/use-ag-action.js';

export interface IMatrixLoginProps {
  accessToken: string;
  homeServer: string;
}

export interface IWalletProps {
  address: string;
  did: string;
  matrix: IMatrixLoginProps;
}

export interface IOraclesContextProps {
  wallet: IWalletProps | null;
  transactSignX: TransactionFn;
  authedRequest: <T>(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    options?: RequestInit,
  ) => Promise<T>;
  // AG-UI action management
  agActions: AgAction[];
  registerAgAction: (
    action: AgAction,
    handler: (args: unknown) => Promise<unknown> | unknown,
    render?: (props: Record<string, unknown>) => React.ReactElement | null,
  ) => void;
  unregisterAgAction: (name: string) => void;
  executeAgAction: (name: string, args: unknown) => Promise<unknown>;
  getAgActionRender: (
    name: string,
  ) => ((props: Record<string, unknown>) => React.ReactElement | null) | undefined;
}

export interface IOraclesProviderProps {
  initialWallet: IWalletProps;
  transactSignX: TransactionFn;
}
