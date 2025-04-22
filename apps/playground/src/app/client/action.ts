'use server';

// import { walletClient } from '@/actions/client';

const sign = async (tx: any[]) => {
  // console.log(tx);
  const client = await import('@ixo/oracles-chain-client');
  const walletClient = client.Client.getInstance();
  await walletClient.signAndBroadcast(tx);
};

export { sign };
