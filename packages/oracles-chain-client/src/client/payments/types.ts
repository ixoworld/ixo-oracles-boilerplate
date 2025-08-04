import { Coin } from '@cosmjs/proto-signing';
import  z  from 'zod';

type InitialPaymentParams = {
  amount: Coin;
  /**
   * The address of the user who is paying the initial amount ex. collection owner
   */
  userAddress: string;
  /**
   * The address of the grantee who is receiving the initial amount ex. oracle address
   */
  granteeAddress: string;

  /**
   * The claim collection id of the user who is paying the initial amount ex. collection owner
   */
  userClaimCollection: string;
};

export const InitialPaymentParamsSchema = z.object({
  amount: z.object({
    amount: z.string(),
    denom: z.string(),
  }),
  userAddress: z.string(),
  granteeAddress: z.string(),
  userClaimCollection: z.string(),
});
export enum IntentStatus {
  /**
   * ACTIVE - Active: Intent is created and active, payments have been transferred to
   * escrow if there is any
   */
  ACTIVE = 0,
  /**
   * FULFILLED - Fulfilled: Intent is fulfilled, was used to create a claim and funds will
   * be released on claim APPROVAL, or funds will be reverted on claim REJECTION
   * or DISPUTE
   */
  FULFILLED = 1,
  /**
   * EXPIRED - Expired: Intent has expired, payments have been transferred back out of
   * escrow
   */
  EXPIRED = 2,
  UNRECOGNIZED = -1,
}
export type { InitialPaymentParams };
