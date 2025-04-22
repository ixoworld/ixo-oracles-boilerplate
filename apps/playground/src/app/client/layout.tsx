'use client';

// import { walletClient } from '@/actions/client';
import {
  IOraclesProviderProps,
  OraclesProvider,
} from '@ixo/oracles-client-sdk';
import { Group, Paper } from '@mantine/core';
import Link from 'next/link';
import { sign } from './action';

export default function Layout({ children }: { children: React.ReactNode }) {
  const oraclesProviderProps: IOraclesProviderProps = {
    apiKey: process.env.NEXT_PUBLIC_ORACLES_API_KEY || '',
    initialWallet: {
      did: 'did:x:zQ3shY2jRreDd6WfGA3PJdhzHhfC3Uknb6TvPcKriSSmePNks',
      algo: 'secp256k1',
      name: 'yousef testnet  account',
      matrix: {
        roomId: '!xdlkgUtOMyPTlhPves:testmx.ixo.earth',
        userId:
          '@did-ixo-ixo1xpww6379u29ydvh54vmn6na2eyxyp8rk7fsrr0:testmx.ixo.earth',
        address: 'ixo1xpww6379u29ydvh54vmn6na2eyxyp8rk7fsrr0',
        accessToken:
          'syt_ZGlkLWl4by1peG8xeHB3dzYzNzl1Mjl5ZHZoNTR2bW42bmEyZXl4eXA4cms3ZnNycjA_xpdlkWqLSKUZNQXrhGMu_3yUz9t',
      },
      pubKey:
        '029dca0424b3f673157e211b91c3ea87a123d74f8a6d8fc773d4ebbd84fbeedde4',
      address: 'ixo1xpww6379u29ydvh54vmn6na2eyxyp8rk7fsrr0',
    },
    transactSignX: sign as any,
  };
  return (
    <OraclesProvider {...oraclesProviderProps}>
      <Paper shadow="xs" p="xs">
        <Group>
          <Link href="/client">sessions</Link>
          <Link href="/client/payments">payments</Link>
        </Group>
      </Paper>
      {children as any}
    </OraclesProvider>
  );
}
