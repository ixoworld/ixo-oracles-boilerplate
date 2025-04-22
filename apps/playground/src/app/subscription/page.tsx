import { walletClient } from '@/actions/client';
import { SubscriptionStatusBadge } from '@/components/SubscriptionStatusBadge';
import { createCheckoutSession } from '@/utils/payments';
import {
  Alert,
  Anchor,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  rem,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCoins,
  IconCreditCard,
  IconFileCertificate,
  IconFileText,
  IconPlus,
} from '@tabler/icons-react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthzForSubs from './components/authz-for-subs';

// Define types for the API responses
interface SubscriptionData {
  claimCollections: {
    subscriptionClaimsCollectionId: string;
    oracleClaimsCollectionId: string;
  };
  currentPlan: string;
  totalCredits: number;
  planCredits: number;
  status: 'active' | 'inactive' | 'processing';
  adminAddress: string;
}

interface SubscriptionError {
  message: string;
  error: string;
  statusCode: number;
}

// Fetch function placed outside the component or in a separate utility file
async function fetchSubscriptionData() {
  // TODO: Replace with actual user address retrieval logic
  await walletClient.init();
  const userAddress = (await walletClient.wallet.getAccounts())[0].address;

  try {
    const response = await fetch(
      'http://localhost:4200/api/v1/subscriptions/my-subscriptions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userAddress }),
        // Add cache control if needed, e.g., cache: 'no-store' for dynamic data
        cache: 'no-store',
      },
    );

    const data: SubscriptionData | SubscriptionError = await response.json();

    if (!response.ok) {
      if ('message' in data && response.status === 404) {
        return { needsPlan: true, subscription: null, error: null };
      } else {
        throw new Error(
          ('message' in data ? data.message : null) ||
            `HTTP error! status: ${response.status}`,
        );
      }
    } else if ('currentPlan' in data) {
      return { needsPlan: false, subscription: data, error: null };
    } else {
      throw new Error('Unexpected response format');
    }
  } catch (err: any) {
    console.error('Failed to fetch subscription:', err);
    // In RSC, you might want to throw the error to let an Error Boundary handle it,
    // or return an error state to render directly.
    return {
      needsPlan: false,
      subscription: null,
      error: err.message || 'An unexpected error occurred.',
    };
  }
}

export default async function SubscriptionOverviewPage() {
  const { subscription, needsPlan, error } = await fetchSubscriptionData();
  const userAddress = (await walletClient.wallet.getAccounts())[0].address;
  // RSCs don't have a loading state in the same way as Client Components.
  // You might use React Suspense higher up the tree if needed.

  if (error) {
    // Render error state or throw error for an Error Boundary
    return (
      <Container size="sm" pt="xl">
        <Alert icon={<IconAlertCircle size="1rem" />} title="Error" color="red">
          Error loading subscription: {error}
        </Alert>
      </Container>
    );
  }

  if (needsPlan) {
    return (
      <Container size="sm" pt="xl">
        <Paper shadow="xs" p="xl" withBorder>
          <Stack align="center">
            <ThemeIcon size="xl" radius="xl" variant="light" color="blue">
              <IconCreditCard style={{ width: rem(32), height: rem(32) }} />
            </ThemeIcon>
            <Title order={2} ta="center">
              No Active Subscription
            </Title>
            <Text ta="center">
              You do not currently have an active subscription.
            </Text>
            <Text ta="center">
              Please visit the{' '}
              <Anchor component={Link} href="/subscription/plans">
                Plans page
              </Anchor>{' '}
              to choose a subscription.
            </Text>
            <Button
              component={Link}
              href="/subscription/plans"
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan' }}
              mt="md"
            >
              Choose a Plan
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  if (subscription) {
    // Format credits for display
    const formattedTotalCredits = subscription.totalCredits.toLocaleString();
    const formattedPlanCredits = subscription.planCredits.toLocaleString();

    return (
      <Container size="lg" py="xl">
        <Title p={16} order={4}>
          Hi, {userAddress}
        </Title>
        <Paper radius="md" shadow="sm" p="lg" withBorder>
          <Stack gap="lg">
            <Group justify="space-between">
              <Title order={2}>Subscription Overview</Title>
              <SubscriptionStatusBadge status={subscription.status} />
            </Group>

            <Divider />

            <Stack gap="md">
              <Group wrap="nowrap" gap="xs">
                <ThemeIcon size="sm" variant="light" color="violet">
                  <IconFileText style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">
                  Current Plan:
                </Text>
                <Text fw={500}>{subscription.currentPlan}</Text>
              </Group>

              <Group wrap="nowrap" gap="xs">
                <ThemeIcon size="sm" variant="light" color="orange">
                  <IconCoins style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">
                  Credits:
                </Text>
                <Text fw={500}>
                  {formattedTotalCredits} / {formattedPlanCredits}
                </Text>
              </Group>
            </Stack>

            <Divider label="Technical Details" labelPosition="center" />

            <Stack gap="xs">
              <Group wrap="nowrap" gap="xs">
                <ThemeIcon size="sm" variant="light" color="gray">
                  <IconFileCertificate
                    style={{ width: '70%', height: '70%' }}
                  />
                </ThemeIcon>
                <Text size="xs" c="dimmed">
                  Subscription Claims Collection:
                </Text>
                <Text size="xs" ff="monospace">
                  {subscription.claimCollections.subscriptionClaimsCollectionId}
                </Text>
              </Group>
              <Group wrap="nowrap" gap="xs">
                <ThemeIcon size="sm" variant="light" color="gray">
                  <IconFileCertificate
                    style={{ width: '70%', height: '70%' }}
                  />
                </ThemeIcon>
                <Text size="xs" c="dimmed">
                  Oracle Claims Collection:
                </Text>
                <Text size="xs" ff="monospace">
                  {subscription.claimCollections.oracleClaimsCollectionId}
                </Text>
              </Group>
            </Stack>

            <Button
              type="submit"
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan' }}
              mt="md"
              leftSection={<IconPlus size={16} />}
              fullWidth
              onClick={async () => {
                'use server';
                try {
                  await walletClient.init();
                  // Add check for accounts existence
                  const accounts = await walletClient.wallet.getAccounts();
                  if (!accounts || accounts.length === 0) {
                    throw new Error(
                      'User address not found. Please connect wallet.',
                    );
                  }
                  const userAddress = accounts[0].address;

                  // Use environment variable for base URL if available
                  const baseUrl =
                    process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4300';
                  const successUrl = `${baseUrl}/subscription`;
                  const cancelUrl = `${baseUrl}/subscription`;

                  const url = await createCheckoutSession(
                    userAddress,
                    successUrl,
                    cancelUrl,
                    // No product ID needed for default top-up
                  );
                  redirect(url);
                } catch (error: any) {
                  if (isRedirectError(error)) {
                    throw error;
                  }
                  console.error('Top-up action failed:', error);
                  // Handle error appropriately - maybe redirect with error param?
                  // throw error; // Re-throwing might be needed for Next.js error handling
                }
              }}
            >
              Top Up Credits
            </Button>
          </Stack>
        </Paper>
        <Paper>
          <AuthzForSubs
            adminAddress={subscription.adminAddress}
            oraclesCollectionId={
              subscription.claimCollections.oracleClaimsCollectionId
            }
          />
        </Paper>
      </Container>
    );
  }

  // Fallback case
  return (
    <Container size="sm" pt="xl">
      <Alert
        icon={<IconAlertCircle size="1rem" />}
        title="Status Unknown"
        color="yellow"
      >
        Unable to determine subscription status.
      </Alert>
    </Container>
  );
}
