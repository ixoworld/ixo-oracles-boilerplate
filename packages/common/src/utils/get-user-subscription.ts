import { Logger } from '@ixo/logger';

export const getSubscriptionUrlByNetwork = (
  network: 'mainnet' | 'testnet' | 'devnet',
) => {
  return {
    mainnet: 'https://subscriptions-api-mainnet.ixo-api.workers.dev',
    testnet: 'https://subscriptions-api-testnet.ixo-api.workers.dev',
    devnet: 'https://subscriptions-api.ixo-api.workers.dev',
  }[network];
};

export interface ClaimCollectionsDto {
  oracleClaimsCollectionId?: string;

  subscriptionClaimsCollectionId?: string;
}

export interface GetMySubscriptionsResponseDto {
  claimCollections: ClaimCollectionsDto;
  currentPlan: string;
  currentPlanName: string;
  totalCredits: number;
  planCredits: number;
  status: 'active' | 'inactive' | 'processing' | 'trial';
  adminAddress: string;
}

interface GetUserSubscriptionResponse extends GetMySubscriptionsResponseDto {
  manageSubscriptionUrl: string;
}

export interface GetUserSubscriptionParams {
  network: 'mainnet' | 'testnet' | 'devnet';
  bearerToken: string;
  subscriptionUrl?: string;
}

export const getUserSubscription = async ({
  bearerToken,
  network,
  subscriptionUrl: _subscriptionUrl,
}: GetUserSubscriptionParams): Promise<GetMySubscriptionsResponseDto | null> => {
  const subscriptionUrl =
    _subscriptionUrl ?? getSubscriptionUrlByNetwork(network);
  try {
    Logger.debug('Fetching user subscription from:', subscriptionUrl);
    const response = await fetch(
      `${subscriptionUrl.endsWith('/') ? subscriptionUrl.slice(0, -1) : subscriptionUrl}/api/v1/subscriptions`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch user subscription: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();
    if (!data) {
      return null;
    }
    const subscription = data as GetUserSubscriptionResponse;
    return {
      claimCollections: subscription.claimCollections,
      currentPlan: subscription.currentPlan,
      currentPlanName: subscription.currentPlanName,
      totalCredits: subscription.totalCredits,
      planCredits: subscription.planCredits,
      status: subscription.status,
      adminAddress: subscription.adminAddress,
    };
  } catch (error) {
    console.error('Error fetching user subscription:', error);
    return null;
  }
};
