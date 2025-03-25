/* eslint-disable @typescript-eslint/no-unnecessary-condition -- f */
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { createQueryClient, createSigningClient } from '@ixo/impactxclient-sdk';
import store from 'store';
import { type QueryClientType, type SigningClientType } from '../ixo-client.js';

import { TxResponse } from '@ixo/impactxclient-sdk/types/codegen/cosmos/base/abci/v1beta1/abci.js';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL;
const SECP_MNEMONIC = process.env.SECP_MNEMONIC;
const CELLNODE_URL = process.env.CELLNODE_URL;

export class Client {
  public queryClient!: QueryClientType;
  public signingClient!: SigningClientType;
  public wallet!: DirectSecp256k1HdWallet;

  private static instance: Client;

  private readonly secpMnemonic: string;
  private readonly rpcUrl: string;
  // private readonly cellnode: string;

  private constructor(
    secpMnemonic = SECP_MNEMONIC,
    rpcUrl = RPC_URL,
    // cellnode = validateEnvVariable('CELLNODE_URL'),
  ) {
    if (!secpMnemonic || !rpcUrl || !CELLNODE_URL) {
      throw new Error('RPC_URL and SECP_MNEMONIC and CELLNODE_URL must be set');
    }

    this.secpMnemonic = secpMnemonic;
    this.rpcUrl = rpcUrl;
    // this.cellnode = cellnode;
  }

  async checkInitiated(): Promise<void> {
    if (!this.signingClient || !this.wallet || !this.queryClient) {
      await this.init();
    }
  }

  async init(): Promise<void> {
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      this.secpMnemonic,
      {
        prefix: 'ixo',
      },
    );

    this.signingClient = await createSigningClient(
      this.rpcUrl,
      this.wallet,
      false,
      undefined,
      {
        getLocalData: (k) => store.get(k),
        setLocalData: (k, d) => store.set(k, d),
      },
    );
    this.queryClient = await createQueryClient(this.rpcUrl);
  }

  public static getInstance(): Client {
    if (!Client.instance) {
      Client.instance = new Client();
    }
    return Client.instance;
  }

  public async runWithInitiatedClient<T>(
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    await this.checkInitiated();
    return fn(this);
  }

  public async getTxByHash(hash: string): Promise<TxResponse | undefined> {
    await this.checkInitiated();
    const tx = await this.queryClient.cosmos.tx.v1beta1.getTx({ hash });
    return tx.txResponse;
  }
}

export default Client.getInstance();
