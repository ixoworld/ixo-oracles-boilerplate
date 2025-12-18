import type { TransactionFn } from '@ixo/oracles-chain-client/react';
import type { AgAction } from '../../hooks/use-ag-action.js';

export interface IMatrixLoginProps {
  accessToken: string;
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
    handler: (args: any) => Promise<any> | any,
    render?: (props: any) => React.ReactElement | null,
  ) => void;
  unregisterAgAction: (name: string) => void;
  executeAgAction: (name: string, args: any) => Promise<any>;
  getAgActionRender: (
    name: string,
  ) => ((props: any) => React.ReactElement | null) | undefined;
}

export interface IOraclesProviderProps {
  initialWallet: IWalletProps;
  transactSignX: TransactionFn;
}
