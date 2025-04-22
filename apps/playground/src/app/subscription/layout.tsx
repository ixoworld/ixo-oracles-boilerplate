'use client';

import { Container, Tabs } from '@mantine/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Determine the active tab based on the current path
  const activeTab = pathname.endsWith('/plans') ? 'plans' : 'overview';

  return (
    <Container size="lg" py="xl">
      <Tabs value={activeTab}>
        <Tabs.List>
          {/* Use Link component for client-side navigation */}
          <Tabs.Tab value="overview" component={Link} href="/subscription">
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="plans" component={Link} href="/subscription/plans">
            Plans
          </Tabs.Tab>
        </Tabs.List>

        {/* The content for the active route will be rendered here by Next.js */}
        <div style={{ paddingTop: 'var(--mantine-spacing-lg)' }}>
          {children}
        </div>
      </Tabs>
    </Container>
  );
}
