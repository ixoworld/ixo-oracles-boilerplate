'use client';

import { OraclesProvider } from '@ixo/oracles-client-sdk';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <OraclesProvider
      apiKey=""
      transactSignX={console.log}
      initialWallet={{
        address:
          'syt_ZGlkLWl4by1peG8xeHB3dzYzNzl1Mjl5ZHZoNTR2bW42bmEyZXl4eXA4cms3ZnNycjA_xpdlkWqLSKUZNQXrhGMu_3yUz9t',
        matrix: {
          accessToken:
            'syt_ZGlkLWl4by1peG8xeHB3dzYzNzl1Mjl5ZHZoNTR2bW42bmEyZXl4eXA4cms3ZnNycjA_xpdlkWqLSKUZNQXrhGMu_3yUz9t',
        },
        did: 'did:x:zQ3shY2jRreDd6WfGA3PJdhzHhfC3Uknb6TvPcKriSSmePNks',
      }}
    >
      {children as any}
    </OraclesProvider>
  );
}
