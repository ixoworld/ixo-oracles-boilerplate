# Authorization (Authz)

Class for managing IXO blockchain authorization grants and permissions for oracles.

## Quick Start

```typescript
import { Authz } from '@ixo/oracles-chain-client';

const authzConfig = await Authz.getOracleAuthZConfig({
  oracleDid: 'did:ixo:entity:...',
  granterAddress: 'ixo1...',
});

const authz = new Authz(authzConfig);

// Grant permissions
await authz.grant(signFunction);

// Check user permissions
const hasPermission = await authz.hasPermission(
  '/ixo.claims.v1beta1.MsgSubmitClaim',
  userClaimCollectionId,
);
```

## Configuration

```typescript
interface IAuthzConfig {
  granteeAddress: string; // Oracle address receiving permissions
  granterAddress: string; // Address granting permissions
  oracleName: string; // Oracle identifier
  requiredPermissions: string[]; // Array of message type URLs
  expirationDays?: number; // Default: 30 days
  spendLimit?: Array<{
    // For send authorizations
    amount: string;
    denom: string;
  }>;
}
```

## Core Methods

### `grant(signFunction, overrideConfig?)`

Grants all required permissions to the oracle.

### `hasPermission(msgTypeUrl, userClaimCollectionId)`

Checks if oracle has specific permissions for a user's claim collection.

### `getUserGrants(userClaimCollectionId)`

Returns all active grants for the oracle from a user's claim collection.

## Oracle Contracting

For basic oracles that need claim submission permissions:

```typescript
// Contract an oracle with claim submit authorization
await authz.contractOracle(
  {
    oracleAddress: 'ixo1oracle...',
    oracleName: 'Basic Oracle',
    accountAddress: 'ixo1account...',
    adminAddress: 'ixo1admin...',
    claimCollectionId: 'collection123',
    maxAmount: [{ amount: '1000', denom: 'uixo' }],
    agentQuota: 100,
  },
  signFunction,
);
```

The `contractOracle` method is used for basic oracles to add submit claim authorization.

## Static Helpers

- `getOracleAuthZConfig(params)` - Fetches oracle config from protocol settings
- `createMsgGrantAuthz(payload)` - Creates generic authorization message
- `createMsgGrantSend(payload)` - Creates send authorization message
- `createMsgExecAuthZ(payload)` - Creates execution message for authorized actions

## Common Permissions

```typescript
// Claim operations
'/ixo.claims.v1beta1.MsgSubmitClaim';
'/ixo.claims.v1beta1.MsgEvaluateClaim';

// Token operations
'/cosmos.bank.v1beta1.MsgSend';
'/cosmos.bank.v1beta1.MsgMultiSend';

// Entity operations
'/ixo.entity.v1beta1.MsgUpdateEntity';
```

## Notes

- Permissions expire after 30 days by default
- Send authorizations require spend limits
- Class handles automatic authorization type detection
