# @ixo/ucan

A framework-agnostic UCAN (User Controlled Authorization Networks) implementation for any service. Built on top of the battle-tested [ucanto](https://github.com/storacha/ucanto) library and conforming to the [UCAN specification](https://github.com/ucan-wg/spec/).

## What is UCAN?

UCAN is a decentralized authorization system using cryptographically signed tokens. Think of it as "JWT meets capabilities" - users can grant specific permissions to others, who can further delegate (but never escalate) those permissions.

**Key concepts:**
- **Capabilities**: What actions can be performed on which resources
- **Delegations**: Granting capabilities to others (can be chained)
- **Invocations**: Requests to use a capability
- **Attenuation**: Permissions can only be narrowed, never expanded

📖 **[See the visual flow diagram →](./docs/FLOW.md)**

## Features

- 🔐 **Built on ucanto** - Battle-tested UCAN library from Storacha
- 🎯 **Generic Capabilities** - Define your own capabilities with custom schemas
- ⚙️ **Caveat Validation** - Enforce limits and restrictions on delegations
- 🌐 **Multi-DID Support** - `did:key` (native) + `did:ixo` (via blockchain indexer)
- 🚀 **Framework-Agnostic** - Works with Express, Fastify, Hono, NestJS, etc.
- 🛡️ **Replay Protection** - Built-in invocation store prevents replay attacks

## Installation

```bash
npm install @ixo/ucan
# or
pnpm add @ixo/ucan
```

## Quick Start

### 1. Define a Capability

```typescript
import { defineCapability, Schema } from '@ixo/ucan';

const EmployeesRead = defineCapability({
  can: 'employees/read',
  protocol: 'myapp:',
  nb: { limit: Schema.integer().optional() },
  derives: (claimed, delegated) => {
    const claimedLimit = claimed.nb?.limit ?? Infinity;
    const delegatedLimit = delegated.nb?.limit ?? Infinity;

    if (claimedLimit > delegatedLimit) {
      return { error: new Error(`Limit ${claimedLimit} exceeds allowed ${delegatedLimit}`) };
    }
    return { ok: {} };
  },
});
```

### 2. Create a Validator (Server)

```typescript
import { createUCANValidator, createIxoDIDResolver } from '@ixo/ucan';

const validator = await createUCANValidator({
  serverDid: 'did:ixo:ixo1abc...',  // Your server's DID
  rootIssuers: ['did:ixo:ixo1admin...'],  // DIDs that can issue root capabilities
  didResolver: createIxoDIDResolver({
    indexerUrl: 'https://blocksync.ixo.earth/graphql',
  }),
});
```

### 3. Protect a Route

```typescript
app.post('/employees', async (req, res) => {
  const result = await validator.validate(
    req.body.invocation,  // Base64-encoded CAR
    EmployeesRead,
    'myapp:company/acme'
  );

  if (!result.ok) {
    return res.status(403).json({ error: result.error });
  }

  const limit = result.capability?.nb?.limit ?? 10;
  res.json({ employees: getEmployees(limit) });
});
```

### 4. Create & Use a Delegation (Client)

```typescript
import { generateKeypair, createDelegation, createInvocation, serializeInvocation } from '@ixo/ucan';

// Generate a keypair for the user
const { signer, did } = await generateKeypair();

// Root creates a delegation for the user
const delegation = await createDelegation({
  issuer: rootSigner,
  audience: did,
  capabilities: [{ can: 'employees/read', with: 'myapp:company/acme', nb: { limit: 50 } }],
  expiration: Math.floor(Date.now() / 1000) + 3600,  // 1 hour
});

// User creates an invocation
const invocation = await createInvocation({
  issuer: signer,
  audience: serverDid,
  capability: { can: 'employees/read', with: 'myapp:company/acme', nb: { limit: 25 } },
  proofs: [delegation],
});

// Serialize and send
const serialized = await serializeInvocation(invocation);
await fetch('/employees', {
  method: 'POST',
  body: JSON.stringify({ invocation: serialized }),
});
```

## Documentation

| Document | Description |
|----------|-------------|
| **[Flow Diagram](./docs/FLOW.md)** | Visual explanation of UCAN delegation and invocation |
| **[Server Example](./docs/examples/SERVER.md)** | Complete Express server with protected routes |
| **[Client Example](./docs/examples/CLIENT.md)** | Frontend/client-side usage |
| **[Capabilities Guide](./docs/examples/CAPABILITIES.md)** | How to define custom capabilities with caveats |

## API Reference

### Capability Definition

```typescript
defineCapability(options: DefineCapabilityOptions)
```

Define a capability with optional caveat validation.

| Option | Type | Description |
|--------|------|-------------|
| `can` | `string` | Action name (e.g., `'employees/read'`) |
| `protocol` | `string` | URI protocol (default: `'urn:'`) |
| `nb` | `object` | Schema for caveats using `Schema.*` |
| `derives` | `function` | Custom validation for attenuation |

### Validator

```typescript
createUCANValidator(options: CreateValidatorOptions): Promise<UCANValidator>
```

Create a framework-agnostic validator.

| Option | Type | Description |
|--------|------|-------------|
| `serverDid` | `string` | Server's DID (any method supported) |
| `rootIssuers` | `string[]` | DIDs that can self-issue capabilities |
| `didResolver` | `DIDKeyResolver` | Resolver for non-`did:key` DIDs |
| `invocationStore` | `InvocationStore` | Custom store for replay protection |

### Client Helpers

| Function | Description |
|----------|-------------|
| `generateKeypair()` | Generate new Ed25519 keypair |
| `parseSigner(privateKey, did?)` | Parse private key into signer |
| `signerFromMnemonic(mnemonic, did?)` | Derive signer from BIP39 mnemonic |
| `createDelegation(options)` | Create a delegation |
| `createInvocation(options)` | Create an invocation |
| `serializeDelegation(delegation)` | Serialize to base64 CAR |
| `serializeInvocation(invocation)` | Serialize to base64 CAR |
| `parseDelegation(serialized)` | Parse from base64 CAR |

### DID Resolution

```typescript
createIxoDIDResolver(config: IxoDIDResolverConfig): DIDKeyResolver
createCompositeDIDResolver(resolvers: DIDKeyResolver[]): DIDKeyResolver
```

### Replay Protection

```typescript
new InMemoryInvocationStore(options?)
createInvocationStore(options?)
```

## DID Support

| DID Method | Support | Notes |
|------------|---------|-------|
| `did:key` | ✅ Native | Parsed directly from the identifier |
| `did:ixo` | ✅ Via resolver | Resolved via IXO blockchain indexer |
| `did:web` | 🔧 Extendable | Implement custom resolver |

## Environment Variables

```env
# For IXO DID resolution
BLOCKSYNC_GRAPHQL_URL=https://blocksync.ixo.earth/graphql
```

## Advanced Usage

### Re-exported ucanto Packages

For advanced use cases, you can access the underlying ucanto packages:

```typescript
import { UcantoServer, UcantoClient, UcantoValidator, ed25519 } from '@ixo/ucan';
```

### Custom Invocation Store

Implement the `InvocationStore` interface for distributed deployments:

```typescript
interface InvocationStore {
  has(cid: string): Promise<boolean>;
  add(cid: string, ttlMs?: number): Promise<void>;
  cleanup?(): Promise<void>;
}
```

## Contributing

See the [test script](./scripts/test-ucan.ts) for a complete example of the UCAN flow:

```bash
pnpm test:ucan
```

## License

MIT

## Links

- [ucanto (underlying library)](https://github.com/storacha/ucanto)
- [UCAN Specification](https://github.com/ucan-wg/spec/)
- [IXO Network](https://www.ixo.world/)
