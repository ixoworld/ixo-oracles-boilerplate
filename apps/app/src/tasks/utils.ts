import { Logger } from '@nestjs/common';

/**
 * Submits a claim to the subscription API endpoint
 * @param submitClaimToSubscriptionApi - The base URL of the subscription API
 * @param claimId - The claim ID to submit
 * @returns Promise resolving to the API response
 */
export async function submitClaimToSubscriptionApi(
  subscriptionApiUrl: string,
  claimId: string,
): Promise<{ approved: boolean; reason?: string }> {
  const webhookUrl = `${subscriptionApiUrl}/api/v1/webhook/claim-submitted`;

  const payload = {
    claimId,
  };

  Logger.log(
    'Submitting claim to subscription API',
    'SubmitClaimToSubscriptionApi',
    {
      webhookUrl,
      claimId,
    },
  );

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    Logger.error(
      `Subscription API error: ${response.status} ${errorBody}`,
      'SubmitClaimToSubscriptionApi',
      {
        status: response.status,
        errorBody,
        claimId,
      },
    );
    throw new Error(`Subscription API error: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as { approved: boolean; reason?: string };
}
