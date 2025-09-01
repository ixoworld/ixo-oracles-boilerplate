# @ixo/oracles-chain-client

TypeScript client library for IXO blockchain operations, specifically designed for oracle builders and blockchain workflows.

## Overview

Provides high-level abstractions for IXO blockchain interactions:

- **Client**: Wallet management, transaction signing, automatic gas estimation
- **Authz**: Oracle permission management and delegated operations
- **Claims**: Claim submission workflows and payment intents
- **Entities**: Entity creation, querying, and configuration management
- **Payments**: Oracle payment workflows with escrow functionality
- **Crypto**: ECIES encryption/decryption utilities for secure data handling
- **React**: React-specific utilities and hooks for frontend integration

## Key Features

- **Smart Fee Calculation**: Automatic gas estimation with intelligent fallbacks
- **Authorization Management**: Complete oracle permission workflows
- **Payment Workflows**: Escrow-based payment system for oracle services
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **React Ready**: Built-in React hooks and components
- **Production Tested**: Battle-tested in production oracle environments

## Installation

```bash
npm install @ixo/oracles-chain-client
# or
pnpm add @ixo/oracles-chain-client
```

## Quick Setup

### Environment Configuration

Create a `.env` file with the required configuration:

```env
RPC_URL=https://devnet.ixo.earth/rpc/
SECP_MNEMONIC=your-wallet-mnemonic-phrase-here
```

### Basic Usage

```typescript
import {
  walletClient,
  claimsClient,
  gqlClient,
} from '@ixo/oracles-chain-client';

// Initialize wallet client
await walletClient.checkInitiated();

// Submit a claim
await claimsClient.submitClaim({
  granteeAddress: 'ixo1oracle...',
  claimId: 'claim-123',
  collectionId: 'collection-456',
});

// Query blockchain data
const entities = await gqlClient.GetEntitiesByOwnerAddress({
  ownerAddress: 'ixo1...',
});
```

## Modules

### Core Modules

- **[Client](./docs/client.md)**: Wallet management and transaction signing
- **[Authz](./docs/authz.md)**: Oracle authorization and permission management
- **[Claims](./docs/claims.md)**: Claim submission and intent workflows
- **[Entities](./docs/entities.md)**: Entity creation and management
- **[Payments](./docs/payments.md)**: Oracle payment and escrow workflows
- **[Crypto](./docs/crypto.md)**: ECIES encryption/decryption utilities

### React Integration

```typescript
import { Payments, Authz } from '@ixo/oracles-chain-client/react';

// Use in React components with full TypeScript support
const MyOracleComponent = () => {
  const handlePayment = async () => {
    const payments = new Payments();
    await payments.payClaim(params);
  };

  return <button onClick={handlePayment}>Pay Oracle</button>;
};
```

## API Documentation

Complete documentation for all modules:

- **[Client](./docs/client.md)** - Wallet client and transaction management
- **[Authz](./docs/authz.md)** - Authorization and permissions
- **[Claims](./docs/claims.md)** - Claim operations and intents
- **[Entities](./docs/entities.md)** - Entity management and queries
- **[Payments](./docs/payments.md)** - Payment workflows and pricing
- **[Crypto](./docs/crypto.md)** - ECIES encryption and secure data handling

## Development

```bash
# Build package
pnpm build

# Run tests
pnpm test

# Generate GraphQL types
pnpm generate
```

## Contributing

Contributions welcome! Ensure tests pass and follow existing patterns.

## License

Licensed under terms in package.json.
