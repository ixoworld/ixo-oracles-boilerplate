import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { type DeliverTxResponse, type StdFee } from '@cosmjs/stargate';
import {
  cosmos,
  createQueryClient,
  createSigningClient,
  customMessages,
  customQueries,
  ixo,
  utils,
} from '@ixo/impactxclient-sdk';
import { type LinkedResource } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types.js';

import { type CellnodePublicResource } from '@ixo/impactxclient-sdk/types/custom_queries/cellnode.js';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import 'dotenv/config';
import store from 'store';
import { hasAuthzSAClaims, queryClaimCollectionById } from './graphql.js';
import {
  AgentRoles,
  type ISubmitClaimPayload,
  type Networks,
  type VerifiableCredential,
} from './type.js';

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
    _protocolId: string,
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

    const address = accounts[0]?.address;
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
      address ?? '',
      messages,
      'Submit Claims',
    );
    const fee = this.getFee(messages.length, gasEstimation);

    return this.signingClient.signAndBroadcast(
      address ?? '',
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

    const address = accounts[0]?.address;
    const did = utils.did.generateSecpDid(accounts[0]?.address ?? '');

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
      address ?? '',
      messages,
      'Apply As service Agent',
    );
    const fee = this.getFee(messages.length, gasEstimation);
    await this.signingClient.signAndBroadcast(
      address ?? '',
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

    const address = accounts[0]?.address;
    const granteeGrants =
      await this.queryClient.cosmos.authz.v1beta1.granteeGrants({
        grantee: address ?? '',
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
  async uploadFile(
    data: any,
    storage: string,
  ): Promise<{
    cid: string;
    serviceEndpoint: string;
  }> {
    if (!this.cellnode) throw new Error('Cellnode URL is not set');

    let cid: string;
    let serviceEndpoint = '';
    // if storage is ipfs, upload to ipfs
    if ((storage || 'cellnode') === 'ipfs') {
      const doc = await customQueries.cellnode.uploadWeb3Doc(
        '',
        'application/ld+json',
        Buffer.from(JSON.stringify(data)).toString('base64'),
        this.cellnode,
      );
      cid = doc.cid;
      serviceEndpoint = doc.url;
    } else {
      // if storage is cellnode, upload to cellnode
      const doc = await customQueries.cellnode.uploadPublicDoc(
        'application/ld+json',
        Buffer.from(JSON.stringify(data)).toString('base64'),
        this.cellnode,
      );
      cid = doc.key;
      serviceEndpoint = doc.url;
    }
    if (!cid) throw new Error('File upload failed');

    return { cid, serviceEndpoint };
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

  async createEntity({
    context,
    profile,
    page,
  }: {
    context: [
      {
        key: string;
        val: string;
      },
    ];
    profile?: Partial<Profile>;
    page?: {
      title: string;
    };
  }): Promise<string> {
    await this.checkInitiated();
    if (!this.queryClient) {
      throw new Error('queryClient is not initialized');
    }
    if (!this.wallet) {
      throw new Error('wallet is not initialized');
    }
    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) throw new Error('No accounts found in wallet');

    const account = accounts[0];
    const myAddress = account?.address ?? '';
    const myPubKey = account?.pubkey ?? '';
    const did = utils.did.generateSecpDid(myAddress);
    const RelayerNode = 'did:ixo:entity:3d079ebc0b332aad3305bb4a51c72edb';
    const profilePayload: Profile = {
      orgName: profile?.orgName ?? profile?.name ?? 'Yousef MCP Default',
      id: 'ixo:entity#profile',
      type: 'Settings',
      name: profile?.name ?? 'Yousef Default Name',
      mediaType: 'application/ld+json',
      image:
        profile?.image ??
        'https://miro.medium.com/v2/resize:fit:1026/1*Gr5xjiQR0wTedSvXVhrsOA.png',
      logo:
        profile?.logo ??
        'https://miro.medium.com/v2/resize:fit:1026/1*Gr5xjiQR0wTedSvXVhrsOA.png',
      brand: profile?.name ?? 'Yousef Default Name',
      location: profile?.location ?? 'EG',
      description: profile?.description ?? 'DEMO MCP SERVICE',
      attributes: profile?.attributes ?? [],
      data: {},
      proof: '',
      serviceEndpoint: '',
    };
    profilePayload.data = { ...profilePayload };
    const pagePayload = {
      '@context': {
        ixo: 'https://w3id.org/ixo/ns/protocol/',
        '@id': '@type',
        type: '@type',
        '@protected': true,
      },
      page: {
        title: 'Page',
        content: [
          {
            id: '1a2b3c4d-1234-5678-9abc-def1234567845',
            type: 'heading',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
              level: 2,
            },
            content: [
              {
                type: 'text',
                text: page?.title ?? 'Page Title',
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '1a2b3c4d-1234-5678-9abc-def123456789',
            type: 'heading',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
              level: 2,
            },
            content: [
              {
                type: 'text',
                text: 'Introduction',
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '2b3c4d5e-2345-6789-abcd-ef2345678901',
            type: 'paragraph',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
            },
            content: [
              {
                type: 'text',
                text: 'The Model Context Protocol (MCP) is an open standard developed to seamlessly integrate AI systems with various data sources, ensuring efficient and secure access to relevant information.',
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '3c4d5e6f-3456-789a-bcde-f34567890123',
            type: 'heading',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
              level: 3,
            },
            content: [
              {
                type: 'text',
                text: 'Key Features',
                styles: {
                  bold: true,
                },
              },
            ],
            children: [],
          },
          {
            id: '4d5e6f7g-4567-89ab-cdef-456789012345',
            type: 'bulletListItem',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
            },
            content: [
              {
                type: 'text',
                text: 'Standardized Integration: Provides a universal approach to connect AI applications with different data repositories.',
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '5e6f7g8h-5678-9abc-def0-567890123456',
            type: 'bulletListItem',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
            },
            content: [
              {
                type: 'text',
                text: 'Security: Ensures encrypted communication between AI systems and data sources.',
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '6f7g8h9i-6789-abcd-ef01-678901234567',
            type: 'heading',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
              level: 3,
            },
            content: [
              {
                type: 'text',
                text: 'Implementation',
                styles: {
                  bold: true,
                },
              },
            ],
            children: [],
          },
          {
            id: '7g8h9i0j-789a-bcde-f012-789012345678',
            type: 'paragraph',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
            },
            content: [
              {
                type: 'text',
                text: "Developers can leverage MCP's SDKs and APIs to integrate AI models with third-party applications and internal systems.",
                styles: {},
              },
            ],
            children: [],
          },
          {
            id: '8h9i0j1k-89ab-cdef-0123-890123456789',
            type: 'heading',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
              level: 2,
            },
            content: [
              {
                type: 'text',
                text: 'Conclusion',
                styles: {
                  bold: true,
                },
              },
            ],
            children: [],
          },
          {
            id: '9i0j1k2l-9abc-def0-1234-901234567890',
            type: 'paragraph',
            props: {
              textColor: 'default',
              backgroundColor: 'default',
              textAlignment: 'left',
            },
            content: [
              {
                type: 'text',
                text: 'MCP facilitates seamless AI integration with external systems, offering a secure, scalable, and efficient framework for modern AI applications.',
                styles: {},
              },
            ],
            children: [],
          },
        ],
      },
    };
    const [profileWeb3, pageWeb3] = await Promise.all([
      this.uploadFile(profilePayload, 'ipfs'),
      this.uploadFile(pagePayload, 'ipfs'),
    ]);
    profilePayload.proof = profileWeb3.cid;
    profilePayload.serviceEndpoint = `ipfs:${profileWeb3.cid}`;

    const message = {
      typeUrl: '/ixo.entity.v1beta1.MsgCreateEntity',
      value: ixo.entity.v1beta1.MsgCreateEntity.fromPartial({
        entityType: 'asset',
        context: customMessages.iid.createAgentIidContext(context),
        verification: [
          ...customMessages.iid.createIidVerificationMethods({
            did,
            pubkey:
              typeof myPubKey === 'string'
                ? new Uint8Array(Buffer.from(myPubKey))
                : myPubKey,
            address: myAddress,
            controller: did,
            type: account?.algo === 'ed25519' ? 'ed' : 'secp',
          }),
        ],
        controller: [did],
        ownerAddress: myAddress,
        ownerDid: did,
        relayerNode: RelayerNode,
        service: [
          {
            id: did,
            serviceEndpoint: 'http://localhost:3001',
            type: 'mcp',
          },
          {
            id: '{id}#cellnode',
            type: 'Cellnode',
            serviceEndpoint: 'https://cellnode-pandora.ixo.earth',
          },
          {
            id: '{id}#ipfs',
            type: 'Ipfs',
            serviceEndpoint: 'https://ipfs.io/ipfs/',
          },
        ],
        linkedResource: [
          ixo.iid.v1beta1.LinkedResource.fromPartial({
            id: `{id}#profile`,
            type: 'Settings',
            description: 'Profile',
            mediaType: 'application/ld+json',
            serviceEndpoint: profilePayload.serviceEndpoint,
            proof: profilePayload.proof,
            encrypted: 'false',
            right: '',
          }),
          ixo.iid.v1beta1.LinkedResource.fromPartial({
            id: `{id}#page`,
            type: 'Settings',
            description: 'Page',
            mediaType: 'application/ld+json',
            serviceEndpoint: `ipfs:${pageWeb3.cid}`,
            proof: pageWeb3.cid,
            encrypted: 'false',
            right: '',
          }),
        ],
        accordedRight: [],
        linkedEntity: [],
        linkedClaim: [],
        startDate: utils.proto.toTimestamp(new Date()),
        // after one year
        endDate: utils.proto.toTimestamp(
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        ),
      }),
    };

    // sign and broadcast
    const gasEstimation = await this.signingClient?.simulate(
      myAddress,
      [message],
      'Create Entity',
    );
    const fee = this.getFee(1, gasEstimation);
    const signed = await this.signingClient?.signAndBroadcast(
      myAddress,
      [message],
      fee,
      'Create Entity',
    );
    const entity = JSON.parse(
      signed?.events
        .find((e) => e.type === 'ixo.entity.v1beta1.EntityCreatedEvent')
        ?.attributes.find((a) => a.key === 'entity')?.value ?? '{}',
    ) as { id: string };
    return entity.id;
  }

  async transferEntity({
    entityDid,
    targetDid,
  }: {
    entityDid: string;
    targetDid: string;
  }): Promise<DeliverTxResponse | undefined> {
    await this.checkInitiated();
    if (!this.wallet) {
      throw new Error('wallet is not initialized');
    }
    const did = process.env.ISSUER_DID;
    const accounts = await this.wallet.getAccounts();
    if (accounts.length === 0) throw new Error('No accounts found in wallet');

    const myAddress = accounts[0]?.address ?? '';
    if (!did) throw new Error('ISSUER_DID is not set');
    const message = {
      typeUrl: '/ixo.entity.v1beta1.MsgTransferEntity',
      value: ixo.entity.v1beta1.MsgTransferEntity.fromPartial({
        id: entityDid,
        ownerDid: did,
        ownerAddress: myAddress,
        recipientDid: targetDid,
      }),
    };
    const gasEstimation = await this.signingClient?.simulate(
      myAddress,
      [message],
      'Transfer Entity',
    );
    const fee = this.getFee(1, gasEstimation);
    const signed = await this.signingClient?.signAndBroadcast(
      myAddress,
      [message],
      fee,
      'Transfer Entity',
    );
    return signed;
  }
}

export default IxoClient.instance;

interface Profile {
  id: string;
  type: string;
  mediaType: string;
  orgName: string;
  name: string;
  image: string;
  logo: string;
  brand: string;
  location: string;
  description: string;
  proof: string;
  serviceEndpoint: string;
  data: Record<string, unknown>;
  attributes: {
    id: string;
    key: string;
    value: string;
  }[];
  metrics?: {
    prefix: string;
    metric: string;
    suffix: string;
    source: string;
  }[];
}
