import { cosmos, ixo } from '@ixo/impactxclient-sdk';
import { TransactionFn } from 'src/client/index.js';
import { gqlClient } from 'src/gql/index.js';
import { getSettingsResource } from 'src/utils/get-settings-resouce.js';
import { ValidationError } from 'src/utils/validation-error.js';
import { TOraclePricingListSchemaResponse } from './types.js';

export class Payments {
  /**
   * @description Executes the payment request by evaluating a claim (approving it)
   * @param params - The parameters for the payment request
   *
   */
  public async payClaim(params: {
    userAddress: string;
    claimCollectionId: string;
    adminAddress: string;
    claimId: string;
    sign: TransactionFn;
  }) {
    const claim = await gqlClient.ClaimById({
      claimId: params.claimId,
    });

    if (claim.claim?.collectionId !== params.claimCollectionId) {
      throw new ValidationError(
        `Claim ${params.claimId} does not belong to collection ${params.claimCollectionId}`,
      );
    }

    const isEvaluated = !!claim.claim?.evaluationByClaimId;
    if (isEvaluated) {
      const status = claim.claim?.evaluationByClaimId?.status;
      throw new ValidationError(
        `Claim ${params.claimId} already evaluated (${status ? ixo.claims.v1beta1.EvaluationStatus[status] : 'unknown'}), cannot pay`,
      );
    }

    const msg = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: params.userAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgEvaluateClaim',
            value: ixo.claims.v1beta1.MsgEvaluateClaim.encode(
              ixo.claims.v1beta1.MsgEvaluateClaim.fromPartial({
                adminAddress: params.adminAddress,
                agentAddress: params.userAddress,
                agentDid: `did:ixo:${params.userAddress}`,
                oracle: `did:ixo:${params.userAddress}`,
                claimId: params.claimId,
                collectionId: params.claimCollectionId,
                status: 1,
                reason: 1,
                verificationProof: 'cid of verificationProof',
              }),
            ).finish(),
          },
        ],
      }),
    };

    return params.sign([msg], `Approve claim ${params.claimId}`);
  }

  public async getOraclePricingList(
    oracleDid: string,
    matrixAccessToken?: string,
  ) {
    const settingsResource = await getSettingsResource(
      {
        protocolDid: oracleDid,
        key: 'pricingList',
      },
      matrixAccessToken,
    );
    return settingsResource as TOraclePricingListSchemaResponse;
  }
}
