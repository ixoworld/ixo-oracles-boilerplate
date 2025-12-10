# @ixo/ucan

UCAN (User Controlled Authorization Networks) implementation for IXO Services. This package wraps the battle-tested [ucanto](https://github.com/storacha/ucanto) library and provides IXO-specific extensions for DID resolution and MCP tool authorization.

## Features

- **did:ixo Resolution**: Resolve IXO DIDs to their public keys via the IXO blockchain indexer
- **MCP Capability Definitions**: Pre-built capability schemas for MCP tool authorization
- **Server & Client Helpers**: Easy setup for ucanto servers and clients with IXO defaults
- **Replay Protection**: In-memory invocation store to prevent replay attacks

## Installation

```bash
pnpm add @ixo/ucan
```

## Quick Start

### Server-Side (Oracle)

```typescript
import { createIxoServer, MCPCall } from '@ixo/ucan';
import { provide } from '@ucanto/server';

// Create a handler for MCP tool calls
const mcpCallHandler = provide(MCPCall, async ({ capability, invocation }) => {
  const { with: resourceUri } = capability;

  // Parse the resource URI to get server/tool info
  // Format: ixo:oracle:{oracleDid}:mcp/{serverName}/{toolName}

  // Execute the MCP tool...
  return { ok: { result: 'success' } };
});

// Create the server
const { server, did } = createIxoServer({
  privateKey: process.env.ORACLE_PRIVATE_KEY!,
  rootIssuers: [process.env.ADMIN_DID!],
  indexerUrl: 'https://blocksync.ixo.earth/graphql',
  service: {
    mcp: { call: mcpCallHandler }
  }
});

console.log('Server DID:', did);
```

### Client-Side

```typescript
import { createIxoClient, createMCPResourceURI } from '@ixo/ucan';

// Create a client
const client = createIxoClient({
  privateKey: myPrivateKey,
  serverDid: 'did:key:z6Mk...',
  endpoint: 'https://oracle.ixo.earth/ucan'
});

// Invoke an MCP tool capability
const result = await client.invoke({
  can: 'mcp/call',
  with: createMCPResourceURI('did:ixo:oracle123', 'postgres', 'query'),
  nb: { args: { sql: 'SELECT * FROM users' } }
});

// Or delegate capability to another user
const delegation = await client.delegate({
  audience: 'did:ixo:alice',
  capabilities: [{
    can: 'mcp/call',
    with: createMCPResourceURI('did:ixo:oracle123', 'postgres', '*')
  }],
  expiration: Math.floor(Date.now() / 1000) + 86400 // 24 hours
});
```

## Capability URI Format

MCP capabilities use the following URI format:

```
ixo:oracle:{oracleDid}:mcp/{serverName}/{toolName}
```

Examples:
- `ixo:oracle:did:ixo:abc123:mcp/postgres/query` - Specific tool
- `ixo:oracle:did:ixo:abc123:mcp/postgres/*` - All tools in server (wildcard)
- `ixo:oracle:did:ixo:abc123:mcp/*` - All MCP tools (wildcard)

## DID Resolution

The package supports multiple DID methods:

- **did:key** - Handled natively by ucanto
- **did:ixo** - Resolved via IXO blockchain indexer

```typescript
import { createIxoDIDResolver, createCompositeDIDResolver } from '@ixo/ucan';

const ixoResolver = createIxoDIDResolver({
  indexerUrl: 'https://blocksync.ixo.earth/graphql'
});

// Create a composite resolver for multiple DID methods
const resolver = createCompositeDIDResolver([ixoResolver]);
```

## Replay Protection

The package includes an in-memory invocation store for replay protection:

```typescript
import { InMemoryInvocationStore } from '@ixo/ucan';

const store = new InMemoryInvocationStore({
  defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  cleanupIntervalMs: 60 * 60 * 1000,  // 1 hour
});

// Check if invocation was already used
if (await store.has(invocationCid)) {
  throw new Error('Replay attack detected');
}

// Mark as used
await store.add(invocationCid);
```

## Integration with Oracle

See the oracle app's `src/ucan/` directory for a complete integration example:

- `ucan.config.ts` - Configuration for MCP UCAN requirements
- `ucan.service.ts` - NestJS service for validation
- `ucan.module.ts` - NestJS module

## Environment Variables

For the IXO DID resolver:

```env
BLOCKSYNC_GRAPHQL_URL=https://blocksync.ixo.earth/graphql
```

For UCAN configuration:

```env
ORACLE_ENTITY_DID=did:ixo:your-oracle-did
UCAN_ROOT_ISSUERS=did:ixo:admin1,did:ixo:admin2
UCAN_PROTECTED_MCP_SERVERS=postgres,redis
```

## API Reference

### Types

- `IxoDID` - IXO DID type (`did:ixo:${string}`)
- `KeyDID` - Key DID type (`did:key:${string}`)
- `MCPResourceURI` - MCP resource URI type
- `MCPUCANConfig` - Configuration for MCP UCAN requirements
- `InvocationStore` - Interface for replay protection stores
- `DIDKeyResolver` - DID resolver function type

### Functions

- `createIxoServer(options)` - Create a ucanto server with IXO defaults
- `createIxoClient(options)` - Create a ucanto client with IXO defaults
- `createIxoDIDResolver(config)` - Create a did:ixo resolver
- `createCompositeDIDResolver(resolvers)` - Combine multiple DID resolvers
- `createMCPResourceURI(oracleDid, serverName, toolName)` - Build MCP resource URI
- `parseMCPResourceURI(uri)` - Parse MCP resource URI into components
- `createInvocationStore(options)` - Create an invocation store

### Capabilities

- `MCPCall` - Capability for calling MCP tools

## TODO

- [ ] Add Redis implementation for distributed deployments
- [ ] Add SQLite implementation for persistence
- [ ] Add delegation management utilities
- [ ] Add capability inspection utilities
- [ ] Add support for capability revocation lists
- [ ] Add support for time-based restrictions in caveats

