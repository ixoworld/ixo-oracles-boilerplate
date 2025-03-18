import {
  assertIsDeliverTxSuccess,
  type DeliverTxResponse,
} from '@cosmjs/stargate';
import { getResolver as IxoDidResolver } from '@ixo/did-provider-x';
import {
  createAgent,
  type ICreateVerifiableCredentialArgs,
  type IDataStore,
  type IDIDManager,
  type IKeyManager,
  type IResolver,
  type TAgent,
  type VerifiableCredential,
} from '@veramo/core';
import {
  CredentialIssuerLD,
  LdDefaultContexts,
  VeramoEd25519Signature2018,
  type ContextDoc,
} from '@veramo/credential-ld';
import {
  CredentialPlugin,
  type ICredentialIssuer,
} from '@veramo/credential-w3c';
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import {
  KeyManager,
  MemoryKeyStore,
  MemoryPrivateKeyStore,
} from '@veramo/key-manager';
import { KeyManagementSystem } from '@veramo/kms-local';
import axios from 'axios';
import { Resolver } from 'did-resolver';
import 'dotenv/config';
import { RESOLVER_NETWORKS } from './constants.js';
import {
  Identity,
  type AgentConfig,
  type AgentPluginMethodMap,
} from './identity-agent.js';
import { IxoClient } from './ixo-client.js';
import {
  type CreateAndSubmitResponse,
  type ICreateAndSubmitClaimPayload,
  type ISubmitClaim,
  type Networks,
} from './type.js';

export class Credentials {
  agent?: TAgent<AgentPluginMethodMap>;
  public readonly network: Networks;
  public readonly remoteContext: string[];
  constructor({
    agent,
    network,
    remoteContext,
  }: {
    agent?: TAgent<AgentPluginMethodMap>;
    network: Networks;
    remoteContext?: string[];
  }) {
    if (!network as unknown) {
      throw new Error('Network is required');
    }
    this.agent = agent;
    this.network = network;
    this.remoteContext = remoteContext || ['https://w3id.org/ixo/context/v1'];
  }

  public static instance = new Credentials({
    network: process.env.NETWORK as Networks,
  });

  public async initAgent(
    remoteContext = ['https://w3id.org/ixo/context/v1'],
  ): Promise<void> {
    const remoteContextUrls = remoteContext;
    const remoteContexts = await Promise.all(
      remoteContextUrls.map(async (url) => {
        const res = await axios.get(url);
        if (res.status !== 200) throw new Error(res.statusText);
        if (!res.data) throw new Error('Remote Context not found');
        return res.data as ContextDoc;
      }),
    );

    const contexts = createExtraContexts(remoteContextUrls, remoteContexts);

    this.agent = createAgent<
      IDIDManager & IKeyManager & IDataStore & IResolver & ICredentialIssuer
    >({
      plugins: [
        new KeyManager({
          store: new MemoryKeyStore(),
          kms: {
            local: new KeyManagementSystem(new MemoryPrivateKeyStore()),
          },
        }),
        new DIDManager({
          store: new MemoryDIDStore(),
          defaultProvider: 'did:x',
          providers: {
            'did:x': new KeyDIDProvider({
              defaultKms: 'local',
            }),
            'did:ixo': new KeyDIDProvider({
              defaultKms: 'local',
            }),
          },
        }),
        new DIDResolverPlugin({
          resolver: new Resolver({
            ...IxoDidResolver({
              url: RESOLVER_NETWORKS[this.network],
            }),
          }),
        }),
        new CredentialPlugin(),
        new CredentialIssuerLD({
          contextMaps: [LdDefaultContexts, contexts],
          suites: [new VeramoEd25519Signature2018()],
        }),
      ],
    });
  }

  public async issue_credentials(
    credential: ICreateVerifiableCredentialArgs,
    config: AgentConfig,
  ): Promise<VerifiableCredential> {
    if (!this.agent) await this.initAgent();

    if (!this.agent) {
      // this is just to make typescript happy
      throw new Error('Agent is not defined');
    }

    const identityHandler = new Identity(this.agent, 'demo');

    const issuerId = await identityHandler.load_issuer_did(this.agent, config);
    credential.credential.issuer = { id: issuerId.did };

    this.agent = identityHandler.agent;

    const verifiableCredential: VerifiableCredential = await this.agent.execute(
      'createVerifiableCredential',
      credential,
    );

    if (verifiableCredential.vc) delete verifiableCredential.vc;
    if (verifiableCredential.sub) delete verifiableCredential.sub;
    if (verifiableCredential.iss) delete verifiableCredential.iss;
    if (verifiableCredential.nbf) delete verifiableCredential.nbf;
    if (verifiableCredential.exp) delete verifiableCredential.exp;

    return verifiableCredential;
  }

  public async createAndSubmit(
    payload: ICreateAndSubmitClaimPayload,
  ): Promise<CreateAndSubmitResponse> {
    const verifiedCredential = await this.issue_credentials(
      payload.credential,
      payload.agentConfig,
    );

    // Upload credentials
    const { cid: uploadId } = await IxoClient.instance.uploadFile(
      verifiedCredential,
      payload.storage,
    );

    const claim = {
      claimId: uploadId,
      credentials: verifiedCredential,
    };
    const submitResults = await this.submit({
      claims: [claim],
      collectionId: payload.collectionId,
      type: '',
    });
    return {
      ...submitResults,
      claims: [claim],
    };
  }
  async submit(dto: ISubmitClaim): Promise<DeliverTxResponse> {
    const res = await IxoClient.instance.submitClaim(dto);
    if (!res) throw new Error('Claim submission failed');
    assertIsDeliverTxSuccess(res);
    return res;
  }
}

const createExtraContexts = (
  contextUrls: string[] = [],
  contexts: ContextDoc[] = [],
): Record<string,any> =>
  contextUrls
    .map((url, index) => ({ [url]: contexts[index] }))
    .reduce(
      (acc, curr) => ({ ...acc, ...curr }),
      {} as Record<string, ContextDoc>,
    );

export default Credentials.instance;
