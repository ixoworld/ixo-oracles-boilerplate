import { cosmos, ixo } from '@ixo/impactxclient-sdk';
import {
  TOraclePricingLisJSONLD,
  TOraclePricingListSchemaResponse,
} from 'src/react/types.js';
import { gqlClient } from '../../gql/index.js';
import { getSettingsResource } from '../../utils/get-settings-resouce.js';
import { ValidationError } from '../../utils/validation-error.js';
import { TransactionFn } from '../authz/types.js';
import { claimsClient } from '../claims/claims.js';
import { walletClient } from '../client.js';
import {
  InitialPaymentParams as InitialPaymentRequestParams,
  IntentStatus,
} from './types.js';

export class Payments {
  /**
   * Initiates the payment process by sending funds to an escrow account
   * using the `MsgClaimIntent` message or `Claims.sendClaimIntent` method.
   * This is the first step in the payment workflow.
   */
  public async sendPaymentToEscrow(
    params: Omit<InitialPaymentRequestParams, 'userAddress'> & {
      userClaimCollection: string;
    },
  ) {
    const { amount, userClaimCollection } = params;
    return claimsClient.sendClaimIntent({
      amount: [amount],
      userClaimCollection,
    });
  }

  async checkForActiveIntent(
    params: Omit<InitialPaymentRequestParams, 'amount'> & {
      granteeAddress: string;
    },
  ) {
    await walletClient.init();

    // get all intents
    const activeIntents =
      await walletClient.queryClient.ixo.claims.v1beta1.intentList({});

    const intent = activeIntents.intents.find(
      (intent) =>
        intent.collectionId === params.userClaimCollection &&
        intent.status === IntentStatus.ACTIVE &&
        intent.agentAddress === params.granteeAddress,
    );

    return !!intent;
  }

  /**
   * @description Executes the payment request by submitting a claim against the user's claim collection
   * @param params - The parameters for the payment request
   *
   */
  public async submitPaymentClaim(
    params: InitialPaymentRequestParams,
    claimId: string,
  ) {
    const { userClaimCollection } = params;

    return claimsClient.submitClaim({
      claimId,
      useIntent: true,
      collectionId: userClaimCollection,
      amount: [params.amount],
    });
  }

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

  /**
   * @description Gets the outstanding claims/payments for an oracle in a user's claim collection
   * @param params - The parameters for the payment request
   * @returns The claim IDs of the outstanding payments
   *
   * If the user hasn't evaluated the claim, it will be included in the list
   */
  public async getOutstandingPayments(params: {
    userAddress: string;
    oracleAddress: string;
    userClaimCollection: string;
  }): Promise<string[] | undefined> {
    const claims = await claimsClient.listClaims({
      oracleAddress: params.oracleAddress,
      userAddress: params.userAddress,
      collectionId: params.userClaimCollection,
    });

    const outstandingPayments = claims.claims?.nodes.filter(
      (claim) => claim.evaluationByClaimId === null,
    );

    return outstandingPayments?.map((claim) => claim.claimId);
  }

  static async getOraclePricingList(
    oracleDid: string,
    matrixAccessToken?: string,
  ) {
    const settingsResource = await getSettingsResource<TOraclePricingLisJSONLD>(
      {
        protocolDid: oracleDid,
        id: '{id}#fee',
      },
      matrixAccessToken,
    );
    const pricingList: TOraclePricingListSchemaResponse = [
      {
        amount: settingsResource.offers.priceSpecification.price.toString(),
        denom: settingsResource.offers.priceSpecification.priceCurrency,
        description: settingsResource.description,
        title: settingsResource.name,
      },
    ];
    return pricingList;
  }
}
