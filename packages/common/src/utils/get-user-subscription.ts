export const getSubscriptionUrlByNetwork = (
  network: 'mainnet' | 'testnet' | 'devnet',
) => {
  return {
    mainnet: 'https://subscriptions.oracle.devnet.ixo.earth',
    testnet: 'https://subscriptions.oracle.devnet.ixo.earth',
    devnet: 'https://subscriptions.oracle.devnet.ixo.earth',
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

export interface GetUserSubscriptionParams {
  userId: string;
  network: 'mainnet' | 'testnet' | 'devnet';
  matrixAccessToken: string;
}

export const getUserSubscription = async ({
  userId,
  matrixAccessToken,
  network,
}: GetUserSubscriptionParams) => {
  const subscriptionUrl = getSubscriptionUrlByNetwork(network);
  try {
    const response = await fetch(
      `${subscriptionUrl}/api/v1/subscriptions?userId=${encodeURIComponent(userId)}`,
      {
        method: 'GET',
        headers: {
          'x-matrix-access-token': matrixAccessToken,
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
    return data;
  } catch (error) {
    console.error('Error fetching user subscription:', error);
    return null;
  }
};
