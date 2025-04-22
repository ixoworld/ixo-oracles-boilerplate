import { Badge, MantineColor } from '@mantine/core';
import { IconCircleCheck, IconLoader, IconX } from '@tabler/icons-react';
import React from 'react';

interface SubscriptionStatusBadgeProps {
  status: 'active' | 'inactive' | 'processing';
}

export function SubscriptionStatusBadge({
  status,
}: SubscriptionStatusBadgeProps) {
  let color: MantineColor = 'gray';
  let IconComponent: React.FC<any> | null = null;
  let label = status.charAt(0).toUpperCase() + status.slice(1);

  switch (status) {
    case 'active':
      color = 'teal';
      IconComponent = IconCircleCheck;
      label = 'Active';
      break;
    case 'inactive':
      color = 'gray';
      IconComponent = IconX;
      label = 'Inactive';
      break;
    case 'processing':
      color = 'blue';
      IconComponent = IconLoader; // Or IconClock
      label = 'Processing';
      break;
    default:
      // Handle unexpected status values gracefully
      label = `Status: ${status}`;
      break;
  }

  return (
    <Badge
      color={color}
      variant="light"
      size="lg"
      leftSection={IconComponent ? <IconComponent size={14} /> : undefined}
    >
      {label}
    </Badge>
  );
}
