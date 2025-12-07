import { Claims, Client, Payments } from '@ixo/oracles-chain-client';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenLimiter } from 'src/utils/token-limit-handler';

import { getSubscriptionUrlByNetwork } from '@ixo/common';
import { SqliteSaver } from '@ixo/sqlite-saver';
import { entrypoint, task } from '@langchain/langgraph';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ENV, matrixAccountRoomId } from 'src/config';
import { submitClaimToSubscriptionApi } from './utils';

export interface UsageClaim {
  amount: number;
  oracleDid: string;
  oracleEntityDid: string;
  userDid: string;
  service: string;
  oracleName: string;
}
type Denom =
  | 'uixo'
  | 'ibc/6BBE9BD4246F8E04948D5A4EEE7164B2630263B9EBB5E7DC5F0A46C62A2FF97B';

interface ProcessClaimParams {
  userDid: string;
  heldAmount: number;
  subscription: {
    adminAddress: string;
    claimCollections: {
      oracleClaimsCollectionId: string;
    };
    totalCredits: number;
  };
  internalClaimId: string;
  denom: Denom;
  configService: ConfigService<ENV>;
}

@Injectable()
export class TasksService {
  private readonly denom: Denom;
  private readonly claimProcessingCheckpointer: SqliteSaver;
  private readonly claimProcessingDbPath: string;

  constructor(private readonly configService: ConfigService<ENV>) {
    this.denom =
      this.configService.get('NETWORK') === 'mainnet'
        ? 'ibc/6BBE9BD4246F8E04948D5A4EEE7164B2630263B9EBB5E7DC5F0A46C62A2FF97B'
        : 'uixo';

    // Set up SQLite checkpointer for claim processing
    const sqlitePath = this.configService.getOrThrow('SQLITE_DATABASE_PATH');
    const claimProcessingFolder = path.join(sqlitePath, 'claim_processing');
    this.claimProcessingDbPath = path.join(
      claimProcessingFolder,
      'claim-processing.db',
    );

    // Ensure directory exists synchronously
    try {
      mkdirSync(claimProcessingFolder, { recursive: true });
    } catch (err) {
      this.logger.error(
        `Failed to create claim processing folder: ${err}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    this.claimProcessingCheckpointer = SqliteSaver.fromConnString(
      this.claimProcessingDbPath,
    );
  }
  private readonly logger = new Logger(TasksService.name);

  private readonly retryPolicy = {
    maxAttempts: 3,
    backoffFactor: 2,
    initialInterval: 1000,
  };

  // Task: Submit intent (payment to escrow)
  private submitIntentTask = task(
    {
      name: 'submitIntent',
      retry: this.retryPolicy,
    },
    async (params: ProcessClaimParams) => {
      const collectionId =
        params.subscription.claimCollections.oracleClaimsCollectionId;
      if (!collectionId) {
        throw new Error('Oracle claims collection ID not found');
      }

      const paymentsClient = new Payments();

      const hasActiveIntent = await paymentsClient.checkForActiveIntent({
        userClaimCollection: collectionId,
        granteeAddress: params.configService.getOrThrow<string>('ORACLE_DID').replace('did:ixo:', ''),
      });

      if (hasActiveIntent) {
        this.logger.log(`User ${params.userDid} already has an active intent, skipping`);
        return { success: true, transactionHash: null };
      }

      const intent = await paymentsClient.sendPaymentToEscrow({
        amount: {
          amount: params.heldAmount.toString(),
          denom: params.denom,
        },
        userClaimCollection: collectionId,
      });

      if (intent.code !== 0) {
        throw new Error(
          `Failed to send payment to escrow: ${intent.rawLog || 'Unknown error'}`,
        );
      }

      this.logger.log(
        `Successfully sent payment to escrow for user: ${params.userDid} with intent tx hash: ${intent.transactionHash}`,
      );

      return { success: true, transactionHash: intent.transactionHash };
    },
  );

  // Task: Save claim to Matrix
  private saveToMatrixTask = task(
    {
      name: 'saveToMatrix',
      retry: this.retryPolicy,
    },
    async (params: ProcessClaimParams) => {
      const collectionId =
        params.subscription.claimCollections.oracleClaimsCollectionId;
      if (!collectionId) {
        throw new Error('Oracle claims collection ID not found');
      }

      const client = Client.getInstance();
      await client.init();
      const claimsClient = new Claims(client);

      const cid = await claimsClient.saveSignedClaimToMatrix({
        accessToken: params.configService.getOrThrow(
          'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
        ),
        claim: {
          amount: [
            {
              amount: params.heldAmount.toString(),
              denom: params.denom,
            },
          ],
          body: {
            amount: params.heldAmount,
            oracleDid: params.configService.getOrThrow('ORACLE_DID'),
            oracleEntityDid:
              params.configService.getOrThrow('ORACLE_ENTITY_DID'),
            service: `Chatting With AI ${params.configService.getOrThrow('ORACLE_NAME')}`,
            oracleName: params.configService.getOrThrow('ORACLE_NAME'),
            userDid: params.userDid,
          } satisfies UsageClaim,
        },
        collectionId,
        matrixRoomId: matrixAccountRoomId,
        secpMnemonic: params.configService.getOrThrow('SECP_MNEMONIC'),
        matrixValuePin: params.configService.getOrThrow('MATRIX_VALUE_PIN'),
        oracleDid: params.configService.getOrThrow('ORACLE_DID'),
        network: params.configService.getOrThrow('NETWORK'),
      });

      this.logger.log(
        `Successfully submitted and saved signed claim ${cid} for user: ${params.userDid}`,
      );

      return { cid };
    },
  );

  // Task: Submit claim to chain
  private submitToChainTask = task(
    {
      name: 'submitToChain',
      retry: this.retryPolicy,
    },
    async (params: ProcessClaimParams & { cid: string }) => {
      const collectionId =
        params.subscription.claimCollections.oracleClaimsCollectionId;
      if (!collectionId) {
        throw new Error('Oracle claims collection ID not found');
      }

      const client = Client.getInstance();
      await client.init();
      const claimsClient = new Claims(client);

      const result = await claimsClient.submitClaim({
        claimId: params.cid,
        collectionId,
        useIntent: true,
        amount: [
          {
            amount: params.heldAmount.toString(),
            denom: params.denom,
          },
        ],
      });

      if (result.code !== 0) {
        throw new Error(
          `Failed to submit claim to chain: ${result.rawLog || 'Unknown error'}`,
        );
      }

      this.logger.log(
        `Successfully submitted claim ${params.cid} to chain for user: ${params.userDid}`,
      );

      return { success: true, transactionHash: result.transactionHash };
    },
  );

  // Task: Send to subscription API
  private sendToSubsApiTask = task(
    {
      name: 'sendToSubsApi',
      retry: this.retryPolicy,
    },
    async (params: ProcessClaimParams & { cid: string }) => {
      const subscriptionUrl = getSubscriptionUrlByNetwork(
        params.configService.getOrThrow('NETWORK'),
      );

      await submitClaimToSubscriptionApi(subscriptionUrl, params.cid);

      this.logger.log(
        `Successfully sent claim ${params.cid} to subscription API for user: ${params.userDid}`,
      );

      return { success: true };
    },
  );

  // Getter for workflow to ensure checkpointer is initialized
  private getProcessClaimWorkflow() {
    return entrypoint(
      {
        checkpointer: this.claimProcessingCheckpointer,
        name: 'processClaim',
      },
      async (params: ProcessClaimParams) => {
        // Step 1: Submit intent
        await this.submitIntentTask(params);

        // Step 2: Save to Matrix (returns CID)
        const { cid } = await this.saveToMatrixTask(params);

        // Step 3: Submit to chain with CID
        await this.submitToChainTask({ ...params, cid });

        // Step 4: Send to subscription API
        await this.sendToSubsApiTask({ ...params, cid });

        return { success: true, cid };
      },
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processHeldAmount() {
    // Minimum threshold to submit claims (prevents spam of tiny transactions)
    const MINIMUM_CLAIM_THRESHOLD = 5000; // credits (= 5000 uixo)
    const users = await TokenLimiter.listUsersWithHeldAmount(
      MINIMUM_CLAIM_THRESHOLD,
    );
    this.logger.log(`Processing held amount for ${users.length} users`);

    for (const [userDid, _heldAmount] of users) {
      try {
        const heldAmount = Math.round(_heldAmount);
        // Skip if held amount is below threshold
        if (heldAmount < MINIMUM_CLAIM_THRESHOLD) {
          this.logger.debug(
            `Held amount ${heldAmount} for user ${userDid} below threshold ${MINIMUM_CLAIM_THRESHOLD}, skipping`,
          );
          continue;
        }

        const subscription = await TokenLimiter.getSubscriptionPayload(userDid);
        if (!subscription) {
          this.logger.warn(`No subscription found for user: ${userDid}`);
          continue;
        }

        if (!subscription.claimCollections.oracleClaimsCollectionId) {
          this.logger.warn(
            `No oracle claims collection ID found for user: ${userDid}`,
          );
          continue;
        }

        const availableCredits = subscription.totalCredits;

        if (availableCredits < heldAmount) {
          this.logger.warn(
            `Insufficient available credits found for user: ${userDid}`,
          );
          continue;
        }

        // Get or create pending claim (handles amount updates and retries automatically)
        const internalClaimId = await TokenLimiter.getOrCreatePendingClaim(
          userDid,
          heldAmount,
        );

        // Create workflow params
        const workflowParams: ProcessClaimParams = {
          userDid,
          heldAmount,
          subscription: {
            adminAddress: subscription.adminAddress,
            claimCollections: {
              oracleClaimsCollectionId:
                subscription.claimCollections.oracleClaimsCollectionId,
            },
            totalCredits: subscription.totalCredits,
          },
          internalClaimId,
          denom: this.denom,
          configService: this.configService,
        };

        // Create workflow config with thread_id
        const threadId = `${userDid}:${internalClaimId}`;
        const config = {
          configurable: {
            thread_id: threadId,
          },
        };

        // Invoke the workflow
        const workflow = this.getProcessClaimWorkflow();
        const result = await workflow.invoke(workflowParams, config);

        if (result.success && result.cid) {
          // Clear both pending claim and held amount atomically
          await Promise.all([
            TokenLimiter.clearPendingClaim(userDid),
            TokenLimiter.deleteUserHeldAmount(userDid),
          ]);

          this.logger.log(
            `Successfully processed claim ${result.cid} and cleared held amount and pending claim for user: ${userDid}`,
          );
        } else {
          this.logger.warn(
            `Workflow completed but result indicates failure for user: ${userDid}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error processing held amount for user ${userDid}:`,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
        );
        // Don't clear held amount or pending claim - will retry next run
      }
    }
  }
}
