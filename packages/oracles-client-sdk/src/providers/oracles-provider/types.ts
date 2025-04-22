import type { TransactionFn } from '@ixo/oracles-chain-client/client/authz/types';

export interface IMatrixLoginProps {
  address: string;
  accessToken: string;
  roomId: string;
  userId: string;
}

export interface IWalletProps {
  address: string;
  algo: string;
  did: string;
  name: string;
  pubKey: string;
  matrix: IMatrixLoginProps;
}

export interface IOraclesContextProps {
  wallet: IWalletProps | null;
  apiKey: string;
  transactSignX: TransactionFn;
  authedRequest: <T>(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    options?: RequestInit,
  ) => Promise<T>;
}

export interface IOraclesProviderProps {
  initialWallet: IWalletProps;
  transactSignX: TransactionFn;
  apiKey: string;
}
