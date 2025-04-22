'use client';
import { Button, ButtonProps } from '@mantine/core';
import { useTransition } from 'react';

const SignButton = ({
  children,
  sign,
  ...Props
}: ButtonProps & {
  sign: () => Promise<void>;
}) => {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      loading={isPending}
      {...Props}
      onClick={async () => {
        startTransition(async () => {
          await sign();
        });
      }}
    >
      {children}
    </Button>
  );
};

export default SignButton;
