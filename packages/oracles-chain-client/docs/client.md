# Wallet Client

Singleton class for IXO blockchain wallet operations with automatic gas estimation and fee calculation.

## Quick Start

```typescript
import { walletClient } from '@ixo/oracles-chain-client';

await walletClient.checkInitiated();
const tx = await walletClient.signAndBroadcast([
  /* messages */
]);
```

## Environment Variables

```bash
RPC_URL=https://your-rpc-endpoint
SECP_MNEMONIC=your-mnemonic-phrase
```

## API

### Default Client

```typescript
import { walletClient } from '@ixo/oracles-chain-client';

// Auto-initializes on first use
await walletClient.checkInitiated();

// Sign and broadcast
const tx = await walletClient.signAndBroadcast(messages, memo?);
```

### Custom Client

```typescript
import { Client } from '@ixo/oracles-chain-client';

const client = await Client.createCustomClient(mnemonic, rpcUrl);
await client.init();
```

### Methods

- `checkInitiated()` - Ensures client is initialized
- `signAndBroadcast(msgs, memo?)` - Signs and broadcasts transaction
- `getTxByHash(hash)` - Retrieves transaction by hash
- `getFee(trxLength, simGas)` - Calculates transaction fees
- `runWithInitiatedClient(fn)` - Executes function with initialized client

## Fee Strategy

- **Simulation**: Uses transaction simulation for accurate gas estimation
- **Fallback**: Applies transaction length-based calculation if simulation fails
- **Buffer**: Adds 30% gas buffer for successful simulations
- **Auto**: Falls back to automatic fee calculation for high gas requirements
