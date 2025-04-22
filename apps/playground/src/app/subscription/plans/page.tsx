import { walletClient } from '@/actions/client';
import { createCheckoutSession } from '@/utils/payments';
import {
  Badge,
  Button,
  Card,
  Center,
  Grid,
  GridCol,
  Group,
  Image,
  List,
  ListItem,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { redirect } from 'next/navigation';

interface Price {
  id: string;
  object: string;
  active: boolean;
  billing_scheme: string;
  created: number;
  currency: string;
  custom_unit_amount: null;
  livemode: boolean;
  lookup_key: null;
  metadata: Record<string, unknown>;
  nickname: string;
  product: string;
  recurring: {
    interval: string;
    interval_count: number;
    meter: null;
    trial_period_days: null;
    usage_type: string;
  };
  tax_behavior: string;
  tiers_mode: null;
  transform_quantity: null;
  type: string;
  unit_amount: number;
  unit_amount_decimal: string;
}

interface Product {
  id: string;
  object: string;
  active: boolean;
  attributes: string[];
  created: number;
  default_price: null;
  description: string;
  images: string[];
  livemode: boolean;
  marketing_features: { name: string }[];
  metadata: {
    credits?: string;
    recommend?: string;
    Plan?: string;
  };
  name: string;
  package_dimensions: null;
  shippable: null;
  statement_descriptor: string | null;
  tax_code: null;
  type: string;
  unit_label: null;
  updated: number;
  url: null;
  prices: Price[];
}

async function fetchPlans(): Promise<Product[]> {
  try {
    const response = await fetch(
      'http://localhost:4200/api/v1/plans?priceType=recurring',
      {
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: Product[] = await response.json();
    // Reorder plans to put "Pro" in the middle if there are 3 plans
    const proPlanIndex = data.findIndex((p) => p.name === 'Pro');
    if (proPlanIndex !== -1 && data.length === 3) {
      const proPlan = data.splice(proPlanIndex, 1)[0];
      data.splice(1, 0, proPlan);
    }
    return data;
  } catch (error) {
    console.error('Failed to fetch plans:', error);
    return [];
  }
}

const formatPrice = (price: Price): string => {
  const amount = price.unit_amount / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  }).format(amount);
};

// This is now the page component for the /subscription/plans route
export default async function SubscriptionPlansPage() {
  const plans = await fetchPlans();

  return (
    <Grid gutter="lg" align="stretch">
      {plans.map((plan) => {
        const isPro = plan.name === 'Pro';
        const isRecommended = plan.metadata.recommend === 'true';

        return (
          <GridCol key={plan.id} span={{ base: 12, md: 4 }}>
            <Card
              shadow={isPro ? 'lg' : 'sm'}
              padding="lg"
              radius="md"
              withBorder
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                borderWidth: isPro ? '2px' : '1px',
                borderColor: isPro
                  ? 'var(--mantine-color-blue-6)'
                  : isRecommended
                    ? 'var(--mantine-color-blue-5)'
                    : undefined,
                transform: isPro ? 'scale(1.05)' : 'scale(1)',
                transition:
                  'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out',
                zIndex: isPro ? 1 : 0,
              }}
            >
              <Stack align="center" mb="md">
                {isRecommended && !isPro && (
                  <Badge color="blue" variant="light">
                    Recommended
                  </Badge>
                )}
                <Title order={isPro ? 1 : 2} ta="center">
                  {plan.name}
                </Title>
              </Stack>

              {plan.images.length > 0 && (
                <Center mb="md">
                  <Image
                    src={plan.images[0]}
                    alt={`${plan.name} plan image`}
                    h={isPro ? 180 : 160}
                    w="auto"
                    fit="contain"
                  />
                </Center>
              )}

              <Text c="dimmed" ta="center" mb="md" style={{ flexGrow: 1 }}>
                {plan.description}
              </Text>

              <List spacing="xs" size="sm" mb="lg" withPadding>
                {plan.marketing_features.map((feature, index) => (
                  <ListItem key={index}>{feature.name}</ListItem>
                ))}
              </List>

              <Stack align="center" mt="auto">
                {plan.prices.length > 0 && plan.prices[0].unit_amount > 0 && (
                  <Group gap="xs" justify="center" mb="md">
                    <Text fz={isPro ? 'h1' : 'h2'} fw={700}>
                      {formatPrice(plan.prices[0])}
                    </Text>
                    <Text c="dimmed" fz="sm">
                      /{plan.prices[0].recurring.interval}
                    </Text>
                  </Group>
                )}
                {plan.prices.length > 0 && plan.prices[0].unit_amount === 0 && (
                  <Text fz={isPro ? 'h1' : 'h2'} fw={700} mb="md">
                    Contact Us
                  </Text>
                )}
                <Button
                  fullWidth
                  variant={isPro ? 'filled' : 'light'}
                  color={isPro ? 'blue' : 'gray'}
                  disabled={!isPro}
                  radius="md"
                  size={isPro ? 'lg' : 'md'}
                  onClick={async () => {
                    'use server';
                    await walletClient.init();
                    const userAddress = (
                      await walletClient.wallet.getAccounts()
                    )[0].address;
                    const url = await createCheckoutSession(
                      userAddress,
                      'http://localhost:4300/subscription',
                      'http://localhost:4300/subscription',
                      plan.id,
                    );
                    redirect(url);
                  }}
                >
                  {isPro ? 'Choose Plan' : 'Coming Soon'}
                </Button>
              </Stack>
            </Card>
          </GridCol>
        );
      })}
    </Grid>
  );
}
