# Claims

Singleton class for managing IXO blockchain claim operations including submission, intent, and listing.

## Quick Start

```typescript
import { claimsClient } from '@ixo/oracles-chain-client';

// Submit a claim
await claimsClient.submitClaim({
  granteeAddress: 'ixo1oracle...',
  claimId: 'claim-123',
  collectionId: 'collection-456',
});

// List claims for an oracle
const claims = await claimsClient.listClaims({
  oracleAddress: 'ixo1oracle...',
  userAddress: 'ixo1user...',
  collectionId: 'collection-456',
});
```

## Core Methods

### `submitClaim(params)`

Submits a claim to the blockchain using authorized execution.

```typescript
await claimsClient.submitClaim({
  granteeAddress: 'ixo1oracle...',    // Oracle address with permissions
  claimId: 'claim-123',               // Unique claim identifier
  collectionId: 'collection-456',     // Target claim collection
  useIntent?: false,                  // Whether to use claim intent
  amount?: [{ amount: '100', denom: 'uixo' }], // Optional payment
});
```

### `sendClaimIntent(params)`

Sends a claim intent before actual submission.

```typescript
await claimsClient.sendClaimIntent({
  granteeAddress: 'ixo1oracle...',
  userClaimCollection: 'collection-456',
  amount: [{ amount: '100', denom: 'uixo' }],
});
```

### `listClaims(params)`

Retrieves claims for an oracle and collection.

```typescript
const claims = await claimsClient.listClaims({
  oracleAddress: 'ixo1oracle...',
  userAddress: 'ixo1user...',
  collectionId: 'collection-456',
});
```

### `getUserOraclesClaimCollection(userAddress)`

Gets user's oracle claim collection ID.

```typescript
const collectionId =
  await claimsClient.getUserOraclesClaimCollection('ixo1user...');
```

## Parameters

### Coin Format

```typescript
{
  amount: string; // Amount in base units (e.g., "1000000" for 1 IXO)
  denom: string; // Token denomination (e.g., "uixo")
}
```

## Usage with Authorization

Claims operations require proper authorization setup:

```typescript
// 1. First setup authorization (see Authz docs)
await authz.contractOracle(contractParams, signFunction);

// 2. Then submit claims
await claimsClient.submitClaim({
  granteeAddress: oracleAddress,
  claimId: 'generated-claim-id',
  collectionId: userClaimCollection,
});
```

## Message Types

The class handles these IXO message types:

- `/ixo.claims.v1beta1.MsgSubmitClaim` - Claim submission
- `/ixo.claims.v1beta1.MsgClaimIntent` - Claim intent declaration
