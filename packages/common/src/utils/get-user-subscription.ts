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
}: GetUserSubscriptionParams) => {
  const subscriptionUrl =
    _subscriptionUrl ?? getSubscriptionUrlByNetwork(network);
  try {
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
    return data as GetMySubscriptionsResponseDto;
  } catch (error) {
    console.error('Error fetching user subscription:', error);
    return null;
  }
};
