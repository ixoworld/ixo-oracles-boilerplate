import { cosmos, ixo } from '@ixo/impactxclient-sdk';
import { gqlClient } from '../../gql/index.js';
import { ValidationError } from '../../utils/validation-error.js';
import { TransactionFn } from '../authz/types.js';
import Claims from '../claims/claims.js';
import Client from '../client.js';
import { Entities } from '../entities/entity.js';
import {
  InitialPaymentParams as InitialPaymentRequestParams,
  IntentStatus,
} from './types.js';

class Payments {
  /**
   * Initiates the payment process by sending funds to an escrow account
   * using the `MsgClaimIntent` message or `Claims.sendClaimIntent` method.
   * This is the first step in the payment workflow.
   */
  public async sendPaymentToEscrow(params: InitialPaymentRequestParams) {
    const { amount, userAddress, granteeAddress } = params;
    return Claims.sendClaimIntent({
      amount: [amount],
      userAddress,
      granteeAddress,
    });
  }

  async checkForActiveIntent(params: InitialPaymentRequestParams) {
    const claimCollectionId = await Claims.getUserOraclesClaimCollection(
      params.userAddress,
    );
    if (!claimCollectionId) {
      throw new Error('Claim collection not found');
    }

    await Client.init();

    // get all intents
    const activeIntents =
      await Client.queryClient.ixo.claims.v1beta1.intentList({});

    const intent = activeIntents.intents.find(
      (intent) =>
        intent.collectionId === claimCollectionId &&
        intent.status === IntentStatus.ACTIVE &&
        intent.agentAddress === params.granteeAddress &&
        // ideally this should be coming from the pricing list in the settings of oracle entity `Entity.getOraclePricingList`
        intent.amount.some(
          (amount) =>
            amount.denom === params.amount.denom &&
            amount.amount === params.amount.amount,
        ),
    );

    return !!intent;
  }

  /**
   * @description Executes the payment request by submitting a claim against the user's claim collection
   * @param params - The parameters for the payment request
   *
   */
  public async submitPaymentClaim(
    params: Omit<InitialPaymentRequestParams, 'amount'>,
    claimId: string,
  ) {
    const { userAddress, granteeAddress } = params;
    const claimCollectionId =
      await Claims.getUserOraclesClaimCollection(userAddress);
    if (!claimCollectionId) {
      throw new Error('Claim collection not found');
    }

    return Claims.submitClaim({
      granteeAddress,
      userAddress,
      claimId,
      useIntent: true,
    });
  }

  /**
   * @description Executes the payment request by evaluating a claim (approving it)
   * @param params - The parameters for the payment request
   *
   */
  public async payClaim(params: {
    userAddress: string;
    userDid: string;
    oracleAddress: string;
    claimId: string;
    sign: TransactionFn;
  }) {
    const claimCollectionId = await Claims.getUserOraclesClaimCollection(
      params.userAddress,
    );
    if (!claimCollectionId) {
      throw new Error('Claim collection not found');
    }
    const collection = await Entities.getClaimCollection(claimCollectionId);
    if (!collection) {
      throw new ValidationError('Claim collection not found');
    }
    const claim = await gqlClient.ClaimById({
      claimId: params.claimId,
    });

    if (claim.claim?.collectionId !== claimCollectionId) {
      throw new ValidationError(
        `Claim ${params.claimId} does not belong to collection ${claimCollectionId}`,
      );
    }

    const isEvaluated = !!claim.claim?.evaluationByClaimId;
    if (isEvaluated) {
      const status = claim.claim?.evaluationByClaimId?.status;
      throw new ValidationError(
        `Claim ${params.claimId} already evaluated (${status ? ixo.claims.v1beta1.EvaluationStatus[status] : 'unknown'}), cannot pay`,
      );
    }
    const adminAddress = collection.admin;

    const msg = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: params.userAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgEvaluateClaim',
            value: ixo.claims.v1beta1.MsgEvaluateClaim.encode(
              ixo.claims.v1beta1.MsgEvaluateClaim.fromPartial({
                adminAddress,
                agentAddress: params.userAddress,
                agentDid: params.userDid,
                oracle: params.userDid,
                claimId: params.claimId,
                reason: 1,
                collectionId: claimCollectionId,
                status: ixo.claims.v1beta1.EvaluationStatus.APPROVED,

                verificationProof: 'cid of verificationProof',
                // if want to do custom amount, must be within allowed authz if through authz
                // amount: customAmount,
                // cw20Payment: customCW20Payment,
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
  }): Promise<string[] | undefined> {
    const claimCollectionId = await Claims.getUserOraclesClaimCollection(
      params.userAddress,
    );
    if (!claimCollectionId) {
      throw new Error('Claim collection not found');
    }

    const claims = await Claims.listClaims({
      oracleAddress: params.oracleAddress,
      userAddress: params.userAddress,
      collectionId: claimCollectionId,
    });

    const outstandingPayments = claims.claims?.nodes.filter(
      (claim) => claim.evaluationByClaimId === null,
    );

    return outstandingPayments?.map((claim) => claim.claimId);
  }
}

export default Payments;
