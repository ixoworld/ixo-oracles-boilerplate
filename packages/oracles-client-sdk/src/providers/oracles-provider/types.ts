import type { TransactionFn } from '@ixo/oracles-chain-client/react';

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
    options?: RequestInit & { openIdToken?: string },
  ) => Promise<T>;
}

export interface IOraclesProviderProps {
  initialWallet: IWalletProps;
  transactSignX: TransactionFn;
}
