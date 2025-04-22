import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { type DeliverTxResponse, type StdFee } from '@cosmjs/stargate';
import {
  cosmos,
  createQueryClient,
  createSigningClient,
  customQueries,
  ixo,
  utils,
} from '@ixo/impactxclient-sdk';
import { type LinkedResource } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types';
import { type CellnodePublicResource } from '@ixo/impactxclient-sdk/types/custom_queries/cellnode';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import 'dotenv/config';
import store from 'store';
import { hasAuthzSAClaims, queryClaimCollectionById } from './graphql';
import {
  AgentRoles,
  type ISubmitClaimPayload,
  type Networks,
  type VerifiableCredential,
} from './type';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (tries) => tries * 500,
});

export type SigningClientType = Awaited<ReturnType<typeof createSigningClient>>;
export type QueryClientType = Awaited<ReturnType<typeof createQueryClient>>;

export class IxoClient {
  private queryClient?: QueryClientType;
  private signingClient?: SigningClientType;
  private wallet?: DirectSecp256k1HdWallet;

  public static instance = new IxoClient();

  private secpMnemonic = this.validateEnvVariable('SECP_MNEMONIC');
  private rpcUrl = this.validateEnvVariable('RPC_URL');
  private cellnode = this.validateEnvVariable('CELLNODE_URL');

  private validateEnvVariable(variableName: string): string {
    const value = process.env[variableName] || '';
    if (!value) {
      throw new Error(`${variableName} is not set`);
    }
    return value;
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

  // ====================================
  //  CLAIMS
  // ====================================
  async validateSchemas(
    protocolId: string,
    schemaType: string,
    credentials: VerifiableCredential[],
  ): Promise<void> {
    if (!schemaType) throw new Error('Schema type is required');
    if (!credentials.length) throw new Error('Credentials are required');

    // Add implementation of schema validation here as needed
  }

  async submitClaim({
    claims,
    collectionId,
    type,
  }: ISubmitClaimPayload): Promise<DeliverTxResponse | undefined> {
    await this.checkInitiated();
    const collection = await this.getCollectionBlocksync(collectionId);

    await this.validateSchemas(
      collection.protocol,
      type,
      claims.reduce<VerifiableCredential[]>(
        (acc, c) => (c.credentials ? [...acc, c.credentials] : acc),
        [],
      ),
    );

    if (!this.signingClient) throw new Error('Signing client not initialized');
    if (!this.wallet) throw new Error('Wallet not initialized');

    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) throw new Error('No accounts found in wallet');

    const address = accounts[0].address;
    const did = process.env.ISSUER_DID;

    const messages = claims.map((c) => ({
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: address,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgSubmitClaim',
            value: ixo.claims.v1beta1.MsgSubmitClaim.encode(
              ixo.claims.v1beta1.MsgSubmitClaim.fromPartial({
                adminAddress: collection.admin,
                agentAddress: address,
                agentDid: did,
                claimId: c.claimId,
                collectionId,
              }),
            ).finish(),
          },
        ],
      }),
    }));

    const gasEstimation = await this.signingClient.simulate(
      address,
      messages,
      'Submit Claims',
    );
    const fee = this.getFee(messages.length, gasEstimation);

    return this.signingClient.signAndBroadcast(
      address,
      messages,
      fee,
      'Submit Claims',
    );
  }

  async applyAsServiceAgent(claimCollectionId: string): Promise<void> {
    await this.checkInitiated();
    if (!this.wallet) {
      throw new Error('wallet is not initialized');
    }
    const surveyBufferedData = Buffer.from(
      JSON.stringify({
        claimCollectionId,
      }),
    ).toString('base64');

    const cellnodeResponse: CellnodePublicResource =
      await customQueries.cellnode.uploadPublicDoc(
        'application/ld+json',
        surveyBufferedData,
        undefined,
        process.env.NETWORK as Networks,
      );

    const linkedResource: LinkedResource =
      ixo.iid.v1beta1.LinkedResource.fromPartial({
        id: `{id}#offer#${claimCollectionId}`,
        type: 'DeedOffer',
        proof: cellnodeResponse.key,
        right: '',
        encrypted: 'false',
        mediaType: 'application/ld+json',
        description: `${claimCollectionId}#SA`,
        serviceEndpoint: cellnodeResponse.url,
      });
    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) throw new Error('No accounts found in wallet');

    const address = accounts[0].address;
    const did = utils.did.generateSecpDid(accounts[0].address);

    const messages = [
      {
        typeUrl: '/ixo.iid.v1beta1.MsgAddLinkedResource',
        value: ixo.iid.v1beta1.MsgAddLinkedResource.fromPartial({
          id: did,
          linkedResource:
            ixo.iid.v1beta1.LinkedResource.fromPartial(linkedResource),
          signer: address,
        }),
      },
    ];
    if (!this.signingClient) {
      throw new Error('singing client not initialized');
    }
    const gasEstimation = await this.signingClient.simulate(
      address,
      messages,
      'Apply As service Agent',
    );
    const fee = this.getFee(messages.length, gasEstimation);
    await this.signingClient.signAndBroadcast(
      address,
      messages,
      fee,
      'Apply As service Agent',
    );
  }

  async checkGranteeRole(
    collectionId: string,
    requiredRole: AgentRoles,
  ): Promise<boolean> {
    await this.checkInitiated();
    if (!this.queryClient) {
      throw new Error('queryClient is not initialized');
    }
    if (!this.wallet) {
      throw new Error('wallet is not initialized');
    }
    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) throw new Error('No accounts found in wallet');

    const address = accounts[0].address;
    const granteeGrants =
      await this.queryClient.cosmos.authz.v1beta1.granteeGrants({
        grantee: address,
      });
    const collection = await this.getCollectionBlocksync(collectionId);

    if (requiredRole === AgentRoles.serviceProviders) {
      const submitAuth = granteeGrants.grants.find(
        (g) =>
          g.authorization?.typeUrl ===
            '/ixo.claims.v1beta1.SubmitClaimAuthorization' &&
          g.granter === collection.admin &&
          (!collectionId ||
            ixo.claims.v1beta1.SubmitClaimAuthorization.decode(
              g.authorization.value,
            ).constraints.find((c) => c.collectionId === collectionId)),
      );
      return Boolean(submitAuth);
    }

    const evaluateAuth = granteeGrants.grants.find(
      (g) =>
        g.authorization?.typeUrl ===
          '/ixo.claims.v1beta1.EvaluateClaimAuthorization' &&
        g.granter === collection.admin &&
        (!collectionId ||
          ixo.claims.v1beta1.EvaluateClaimAuthorization.decode(
            g.authorization.value,
          ).constraints.find((c) => c.collectionId === collectionId)),
    );
    return Boolean(evaluateAuth);
  }

  async oracleHasPendingAuthzClaim({
    userDid,
    claimCollectionId,
  }: {
    userDid: string;
    claimCollectionId: string;
  }): Promise<boolean> {
    const [hasSAClaim, isSA] = await Promise.all([
      hasAuthzSAClaims(userDid, claimCollectionId),
      this.checkGranteeRole(claimCollectionId, AgentRoles.serviceProviders),
    ]);
    return hasSAClaim && !isSA;
  }

  // ====================================
  // Queries routing through blocksync
  // ====================================
  async getCollectionBlocksync(id: string): Promise<{
    protocol: string;
    admin: string;
  }> {
    const claimCollection = (await queryClaimCollectionById(id)) as
      | {
          protocol: string;
          admin: string;
        }
      | undefined;
    if (!claimCollection) throw new Error('Collection not found');
    return claimCollection;
  }

  // ====================================
  //  CUSTOM
  // ====================================
  async uploadFile(data: any, storage: string): Promise<string> {
    if (!this.cellnode) throw new Error('Cellnode URL is not set');

    let cid: string;
    if ((storage || 'cellnode') === 'ipfs') {
      const doc = await customQueries.cellnode.uploadWeb3Doc(
        '',
        'application/ld+json',
        Buffer.from(JSON.stringify(data)).toString('base64'),
        this.cellnode,
      );
      cid = doc.cid;
    } else {
      const doc = await customQueries.cellnode.uploadPublicDoc(
        'application/ld+json',
        Buffer.from(JSON.stringify(data)).toString('base64'),
        this.cellnode,
      );
      cid = doc.key;
    }
    if (!cid) throw new Error('File upload failed');

    return cid;
  }

  getFee(trxLength = 1, simGas?: number): StdFee {
    const simOk = simGas && simGas > 50000;

    return {
      amount: [
        {
          denom: 'uixo',
          amount: simOk
            ? (simGas * 0.1).toFixed(0)
            : (trxLength * 30000).toString(),
        },
      ],
      gas: simOk ? (simGas * 1.3).toFixed(0) : (trxLength * 700000).toString(),
    };
  }
}

export default IxoClient.instance;
