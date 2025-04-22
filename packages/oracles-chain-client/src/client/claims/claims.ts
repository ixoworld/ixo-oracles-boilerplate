import { Coin } from '@cosmjs/proto-signing';
import { cosmos, ixo, utils } from '@ixo/impactxclient-sdk';
import { Logger } from '@ixo/logger';
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
    userAddress: string,
  ): Promise<string | undefined> {
    if (process.env.NODE_ENV === 'production') {
      return undefined;
    }
    Logger.warn(
      '[Authz] getUserOraclesClaimCollection is not implemented',
      'getUserOraclesClaimCollection',
      'notImplemented',
      'userAddress',
      userAddress,
    );
    Logger.warn(
      '[Authz] getUserOraclesClaimCollection returning hardcoded value',
    );
    return process.env.USER_CLAIM_COLLECTION_ID ?? '138';
  }

  public async sendClaimIntent({
    amount,
    userAddress,
    overrideClaimCollectionId,
    granteeAddress,
  }: {
    amount: Coin[];
    userAddress: string; // collection owner
    overrideClaimCollectionId?: string;
    granteeAddress: string; // oracle address
  }) {
    const claimCollectionId =
      overrideClaimCollectionId ??
      (await this.getUserOraclesClaimCollection(userAddress));
    if (!claimCollectionId) {
      throw new ValidationError('Claim collection ID not found');
    }
    return this.client.runWithInitiatedClient(async (client) => {
      const granteeDid = utils.did.generateSecpDid(granteeAddress);
      const message = {
        typeUrl: '/ixo.claims.v1beta1.MsgClaimIntent',
        value: ixo.claims.v1beta1.MsgClaimIntent.fromPartial({
          agentAddress: granteeAddress,
          agentDid: granteeDid,
          collectionId: claimCollectionId,
          amount,
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
    collectionId?: string;
    useIntent?: boolean;
    amount?: Coin[];
  }) {
    if (!userAddress && !collectionId) {
      throw new ValidationError('User address or collection ID is required');
    }
    if (!collectionId && userAddress) {
      collectionId = await this.getUserOraclesClaimCollection(userAddress);
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
    collectionId?: string;
  }) {
    const claimCollectionId =
      params.collectionId ??
      (await this.getUserOraclesClaimCollection(params.userAddress));
    if (!claimCollectionId) {
      throw new ValidationError('Claim collection ID not found');
    }
    const claimsList = await gqlClient.Claims({
      agentAddress: params.oracleAddress,
      collectionId: claimCollectionId,
    });
    return claimsList;
  }
}

export default Claims.getInstance();
