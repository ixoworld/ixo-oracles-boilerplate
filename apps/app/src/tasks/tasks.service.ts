import { Claims, Client, Payments } from '@ixo/oracles-chain-client';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenLimiter } from 'src/utils/token-limit-handler';

import { getSubscriptionUrlByNetwork } from '@ixo/common';
import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/config';
import { submitClaimToSubscriptionApi } from './utils';

type Denom = 'uixo' | 'usdcc';

@Injectable()
export class TasksService {
  private readonly denom: Denom;
  constructor(private readonly configService: ConfigService<ENV>) {
    this.denom =
      this.configService.get('NETWORK') === 'mainnet' ? 'usdcc' : 'uixo';
  }
  private readonly logger = new Logger(TasksService.name);

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processHeldAmount() {
    // Minimum threshold to submit claims (prevents spam of tiny transactions)
    const MINIMUM_CLAIM_THRESHOLD = 5000; // credits (= 5000 uixo)
    const users = await TokenLimiter.listUsersWithHeldAmount(
      MINIMUM_CLAIM_THRESHOLD,
    );
    Logger.log(`Processing held amount for ${users.length} users`);

    for (const [userDid, heldAmount] of users) {
      try {
        // Skip if held amount is below threshold
        if (heldAmount < MINIMUM_CLAIM_THRESHOLD) {
          Logger.debug(
            `Held amount ${heldAmount} for user ${userDid} below threshold ${MINIMUM_CLAIM_THRESHOLD}, skipping`,
          );
          continue;
        }

        const subscription = await TokenLimiter.getSubscriptionPayload(userDid);
        if (!subscription) {
          Logger.warn(`No subscription found for user: ${userDid}`);
          continue;
        }

        if (!subscription.claimCollections.oracleClaimsCollectionId) {
          Logger.warn(
            `No oracle claims collection ID found for user: ${userDid}`,
          );
          continue;
        }

        const availableCredits = subscription.totalCredits;

        if (availableCredits < heldAmount) {
          Logger.warn(
            `Insufficient available credits found for user: ${userDid}`,
          );
          continue;
        }

        // Get or create pending claim (handles amount updates and retries automatically)
        const claimId = await TokenLimiter.getOrCreatePendingClaim(
          userDid,
          heldAmount,
        );

        const client = Client.getInstance();
        await client.init();
        const claimsClient = new Claims(client);
        const { claim: existingClaim } = await claimsClient.getClaim(claimId);
        if (existingClaim?.claimId) {
          Logger.warn(
            `Claim ${claimId} already exists, will not submit again`,
            {
              existingClaim,
            },
          );
        } else {
          const paymentsClient = new Payments();
          const intent = await paymentsClient.sendPaymentToEscrow({
            amount: {
              amount: heldAmount.toString(),
              denom: this.denom,
            },
            userClaimCollection:
              subscription.claimCollections.oracleClaimsCollectionId,
          });
          if (intent.code !== 0) {
            Logger.error(
              `Failed to send payment to escrow for user: ${userDid}`,
              intent.rawLog,
            );
            continue;
          }

          Logger.log(
            `Successfully sent payment to escrow for user: ${userDid} with intent tx hash: ${intent.transactionHash}`,
          );

          const claim = await paymentsClient.submitPaymentClaim(
            {
              userClaimCollection:
                subscription.claimCollections.oracleClaimsCollectionId,
              amount: {
                amount: heldAmount.toString(),
                denom: this.denom,
              },
            },
            claimId,
          );

          if (claim.code !== 0) {
            Logger.error(
              `Failed to submit claim for user: ${userDid}`,
              claim.rawLog,
            );
            continue;
          }

          Logger.log(
            `Successfully submitted claim ${claimId} for user: ${userDid}`,
          );
        }

        await submitClaimToSubscriptionApi(
          getSubscriptionUrlByNetwork(this.configService.getOrThrow('NETWORK')),
          claimId,
        );
        // Clear both pending claim and held amount atomically
        await Promise.all([
          TokenLimiter.clearPendingClaim(userDid),
          TokenLimiter.deleteUserHeldAmount(userDid),
        ]);

        Logger.log(
          `Cleared held amount and pending claim for user: ${userDid}`,
        );
      } catch (error) {
        Logger.error(
          `Error processing held amount for user ${userDid}:`,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
        );
        // Don't clear held amount or pending claim - will retry next run
      }
    }
  }
}
