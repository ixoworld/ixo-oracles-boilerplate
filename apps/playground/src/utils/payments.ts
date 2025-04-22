// Define type for the API response
interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

// Define type for potential API errors
interface ApiError {
  message: string;
  error?: string;
  statusCode?: number;
}

const TOPUP_PRODUCT_ID = 'prod_S5upYD02XoI4Wj';
const CHECKOUT_API_URL =
  'http://localhost:4200/api/v1/payments/checkout-session';

/**
 * Creates a Stripe checkout session for subscriptions or top-ups.
 *
 * @param userAddress - The user's blockchain address.
 * @param successUrl - The URL to redirect to on successful payment.
 * @param cancelUrl - The URL to redirect to if the payment is cancelled.
 * @param productId - Optional product ID for the plan. Defaults to top-up ID if not provided.
 * @returns The checkout session URL.
 * @throws If the API call fails or returns an unexpected response.
 */
export async function createCheckoutSession(
  userAddress: string,
  successUrl: string,
  cancelUrl: string,
  productId?: string,
): Promise<string> {
  const effectiveProductId = productId || TOPUP_PRODUCT_ID;

  try {
    const response = await fetch(CHECKOUT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: effectiveProductId,
        userAddress,
        successUrl,
        cancelUrl,
      }),
    });

    const data: CheckoutSessionResponse | ApiError = await response.json();

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      if ('message' in data && data.message) {
        errorMessage = data.message;
      }
      console.error('API Error creating checkout session:', data);
      throw new Error(errorMessage);
    }

    if ('url' in data && data.url) {
      return data.url;
    } else {
      console.error('Unexpected response format:', data);
      throw new Error(
        'Failed to create checkout session: Invalid response format.',
      );
    }
  } catch (error: any) {
    console.error('Failed to create checkout session:', error);
    // Re-throw the error to be handled by the caller
    throw error instanceof Error
      ? error
      : new Error(
          'An unexpected error occurred during checkout session creation.',
        );
  }
}

// Example Usage (can be removed or adapted):
/*
async function getCheckoutLink() {
  try {
    // Ensure wallet is initialized and get address
    await walletClient.init();
    const accounts = await walletClient.wallet.getAccounts();
    if (accounts.length === 0) {
      throw new Error('No accounts found in wallet.');
    }
    const userAddress = accounts[0].address;

    // Define URLs (potentially dynamically)
    const currentUrl = window.location.href; // Or get from server context if in RSC
    const successUrl = currentUrl; // Redirect back to the current page on success
    const cancelUrl = currentUrl; // Redirect back to the current page on cancel

    // Get URL for the default (top-up) plan
    const topupUrl = await createCheckoutSession(userAddress, successUrl, cancelUrl);
    console.log('Top-up Checkout URL:', topupUrl);

    // Get URL for a specific subscription plan
    const proPlanId = 'prod_Qc1wh108Xh1t3p'; // Example Pro Plan ID
    const proPlanUrl = await createCheckoutSession(userAddress, successUrl, cancelUrl, proPlanId);
    console.log('Pro Plan Checkout URL:', proPlanUrl);

  } catch (error) {
    console.error('Error getting checkout link:', error);
    // Handle error in the UI
  }
}
*/
