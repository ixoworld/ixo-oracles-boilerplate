import { Coin } from '@cosmjs/proto-signing';
import { cosmos, ixo } from '@ixo/impactxclient-sdk';
import { gqlClient } from '../../gql/index.js';
import { ValidationError } from '../../utils/validation-error.js';
import { walletClient } from '../client.js';
import { Entities } from '../entities/entity.js';

export class Claims {
  private static instance: Claims;
  constructor(private readonly client = walletClient) {}

  public static getInstance(): Claims {
    if (!Claims.instance) {
      Claims.instance = new Claims();
    }
    return Claims.instance;
  }
  public async getUserOraclesClaimCollection(
    _userAddress: string,
  ): Promise<string | undefined> {
    if (process.env.NODE_ENV === 'production') {
      return undefined;
    }

    throw new Error('getUserOraclesClaimCollection is not implemented');
  }

  public async sendClaimIntent({
    amount,
    userClaimCollection,
  }: {
    amount: Coin[];
    userClaimCollection: string;
  }) {
    if (!userClaimCollection) {
      throw new ValidationError('Claim collection ID not found');
    }
    return this.client.runWithInitiatedClient(async (client) => {
      const message = {
        typeUrl: '/cosmos.authz.v1beta1.MsgExec',
        value: cosmos.authz.v1beta1.MsgExec.fromPartial({
          grantee: client.address,
          msgs: [
            {
              typeUrl: '/ixo.claims.v1beta1.MsgClaimIntent',
              value: ixo.claims.v1beta1.MsgClaimIntent.encode(
                ixo.claims.v1beta1.MsgClaimIntent.fromPartial({
                  agentAddress: client.address,
                  agentDid: `did:ixo:${client.address}`,
                  collectionId: userClaimCollection,
                  amount,
                }),
              ).finish(),
            },
          ],
        }),
      };
      const tx = await client.signAndBroadcast([message]);
      return tx;
    });
  }

  public async submitClaim({
    claimId,
    collectionId,
    useIntent = false,
    amount,
  }: {
    claimId: string;
    collectionId: string;
    useIntent?: boolean;
    amount?: Coin[];
  }) {
    if (!collectionId) {
      throw new ValidationError('Claim collection ID not found');
    }

    const collection = await Entities.getClaimCollection(collectionId);
    if (!collection) {
      throw new ValidationError('Claim collection not found');
    }

    const adminAddress = collection.admin;
    const message = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: this.client.address,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgSubmitClaim',
            value: ixo.claims.v1beta1.MsgSubmitClaim.encode(
              ixo.claims.v1beta1.MsgSubmitClaim.fromPartial({
                adminAddress: adminAddress,
                agentAddress: this.client.address,
                agentDid: `did:ixo:${this.client.address}`,
                claimId,
                collectionId,
                useIntent,
                amount,
              }),
            ).finish(),
          },
        ],
      }),
    };
    return this.client.runWithInitiatedClient(async (client) => {
      const tx = await client.signAndBroadcast([message]);
      return tx;
    });
  }

  public async listClaims(params: {
    oracleAddress: string;
    userAddress: string;
    collectionId: string;
  }) {
    const claimsList = await gqlClient.Claims({
      agentAddress: params.oracleAddress,
      collectionId: params.collectionId,
    });
    return claimsList;
  }

  public async getClaim(claimId: string) {
    const claim = await gqlClient.ClaimById({ claimId });
    return claim;
  }
}

export const claimsClient = Claims.getInstance();
