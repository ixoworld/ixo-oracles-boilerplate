import { Coin } from '@cosmjs/proto-signing';
import { cosmos, ixo, utils } from '@ixo/impactxclient-sdk';
import { gqlClient } from '../../gql/index.js';
import { ValidationError } from '../../utils/validation-error.js';
import Client from '../client.js';
import { Entities } from '../entities/entity.js';

export class Claims {
  private static instance: Claims;
  constructor(private readonly client = Client) {}

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
    granteeAddress,
  }: {
    amount: Coin[];
    userClaimCollection: string;
    granteeAddress: string; // oracle address
  }) {
    if (!userClaimCollection) {
      throw new ValidationError('Claim collection ID not found');
    }
    return this.client.runWithInitiatedClient(async (client) => {
      const granteeDid = utils.did.generateSecpDid(granteeAddress);
      const message = {
        typeUrl: '/cosmos.authz.v1beta1.MsgExec',
        value: cosmos.authz.v1beta1.MsgExec.fromPartial({
          grantee: granteeAddress,
          msgs: [
            {
              typeUrl: '/ixo.claims.v1beta1.MsgClaimIntent',
              value: ixo.claims.v1beta1.MsgClaimIntent.encode(
                ixo.claims.v1beta1.MsgClaimIntent.fromPartial({
                  agentAddress: granteeAddress,
                  agentDid: granteeDid,
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
    granteeAddress,
    userAddress,
    claimId,
    collectionId,
    useIntent = false,
    amount,
  }: {
    granteeAddress: string;
    userAddress?: string;
    claimId: string;
    collectionId: string;
    useIntent?: boolean;
    amount?: Coin[];
  }) {
    if (!userAddress && !collectionId) {
      throw new ValidationError('User address or collection ID is required');
    }

    if (!collectionId) {
      throw new ValidationError('Claim collection ID not found');
    }
    const collection = await Entities.getClaimCollection(collectionId);
    if (!collection) {
      throw new ValidationError('Claim collection not found');
    }

    const adminAddress = collection.admin;
    const granteeDid = utils.did.generateSecpDid(granteeAddress);
    const message = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: granteeAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgSubmitClaim',
            value: ixo.claims.v1beta1.MsgSubmitClaim.encode(
              ixo.claims.v1beta1.MsgSubmitClaim.fromPartial({
                adminAddress: adminAddress,
                agentAddress: granteeAddress,
                agentDid: granteeDid,
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
}

export default Claims.getInstance();
