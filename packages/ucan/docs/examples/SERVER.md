# Server Example

Complete Express.js server using `@ixo/ucan` for authorization.

## Setup

```bash
npm install express @ixo/ucan
```

## Full Example

```typescript
import express, { Request, Response } from 'express';
import {
  createUCANValidator,
  createIxoDIDResolver,
  defineCapability,
  Schema,
  generateKeypair,
  createDelegation,
  serializeDelegation,
  parseSigner,
  SupportedDID,
} from '@ixo/ucan';

const app = express();
app.use(express.json());

// =============================================================================
// Configuration
// =============================================================================

// Server identity (use did:key for simplicity, or did:ixo for production)
const SERVER_DID = 'did:ixo:ixo1abc...'; // Your server's DID
const ROOT_DID = 'did:ixo:ixo1admin...'; // Admin who can delegate
const ROOT_PRIVATE_KEY = 'MgCY...'; // Admin's private key

// =============================================================================
// Define Capabilities
// =============================================================================

/**
 * Capability with caveat validation (limit)
 *
 * The `derives` function enforces attenuation:
 * - A delegation with limit: 100 can create sub-delegations with limit ≤ 100
 * - An invocation can only request up to the delegated limit
 */
const EmployeesRead = defineCapability({
  can: 'employees/read',
  protocol: 'myapp:',
  nb: { limit: Schema.integer().optional() },
  derives: (claimed, delegated) => {
    const claimedLimit = claimed.nb?.limit ?? Infinity;
    const delegatedLimit = delegated.nb?.limit ?? Infinity;

    if (claimedLimit > delegatedLimit) {
      return {
        error: new Error(
          `Cannot request limit=${claimedLimit}, delegation only allows limit=${delegatedLimit}`,
        ),
      };
    }
    return { ok: {} };
  },
});

/**
 * Simple capability without caveats
 */
const EmployeesWrite = defineCapability({
  can: 'employees/write',
  protocol: 'myapp:',
});

// =============================================================================
// Initialize Validator
// =============================================================================

let validator: Awaited<ReturnType<typeof createUCANValidator>>;

async function initializeServer() {
  // Create DID resolver for did:ixo
  const didResolver = createIxoDIDResolver({
    indexerUrl: 'https://blocksync.ixo.earth/graphql',
  });

  // Create validator (async to resolve non-did:key DIDs at startup)
  validator = await createUCANValidator({
    serverDid: SERVER_DID,
    rootIssuers: [ROOT_DID],
    didResolver,
  });

  console.log('Server DID:', SERVER_DID);
  console.log('Root Issuer:', ROOT_DID);
}

// =============================================================================
// Helper Functions
// =============================================================================

function buildResourceUri(serverDid: string): `myapp:${string}` {
  return `myapp:${serverDid}`;
}

function buildEmployees(limit: number) {
  return Array.from({ length: limit }, (_, i) => ({
    id: i + 1,
    name: `Employee ${i + 1}`,
  }));
}

// =============================================================================
// Routes
// =============================================================================

/**
 * Health check
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Server info and available capabilities
 */
app.get('/info', (_req, res) => {
  res.json({
    serverDid: SERVER_DID,
    rootIssuers: [ROOT_DID],
    capabilities: {
      'employees/read': {
        description: 'Read employee data',
        caveats: { limit: 'Maximum number of employees to return' },
      },
      'employees/write': {
        description: 'Write employee data',
        caveats: null,
      },
    },
  });
});

/**
 * Protected route - requires valid UCAN invocation
 *
 * Send: POST /protected
 * Body: { "invocation": "<base64 CAR>" }
 */
app.post('/protected', async (req: Request, res: Response) => {
  const invocationBase64 = req.body?.invocation;

  if (!invocationBase64) {
    res.status(400).json({
      error: 'Missing invocation in request body',
      hint: 'Send { "invocation": "<base64 CAR>" }',
    });
    return;
  }

  // Validate with capability (includes caveat validation!)
  const result = await validator.validate(
    invocationBase64,
    EmployeesRead,
    buildResourceUri(SERVER_DID),
  );

  if (!result.ok) {
    res.status(403).json({
      error: 'Unauthorized',
      details: result.error,
    });
    return;
  }

  // Extract limit from validated capability
  const limit = (result.capability?.nb?.limit as number) ?? 10;

  res.json({
    message: 'Access granted!',
    invoker: result.invoker,
    capability: result.capability,
    employees: buildEmployees(limit),
  });
});

/**
 * Create delegation for a user
 *
 * Send: POST /delegate
 * Body: {
 *   "audience": "did:key:z6Mk...",
 *   "capabilities": [{ "can": "employees/read", "nb": { "limit": 50 } }],
 *   "expiration": 1735689600  // Optional, defaults to 24h
 * }
 */
app.post('/delegate', async (req: Request, res: Response) => {
  const { audience, capabilities, expiration } = req.body;

  if (!audience) {
    res.status(400).json({
      error: 'Missing audience DID',
      hint: 'Send { "audience": "did:key:..." }',
    });
    return;
  }

  if (!capabilities || !Array.isArray(capabilities)) {
    res.status(400).json({
      error: 'Missing or invalid capabilities',
      hint: 'Send { "capabilities": [{ "can": "employees/read", "nb": { "limit": 50 } }] }',
    });
    return;
  }

  try {
    const rootSigner = parseSigner(ROOT_PRIVATE_KEY, ROOT_DID as SupportedDID);

    // Build full capabilities with resource URI
    const fullCapabilities = capabilities.map((cap: any) => ({
      can: cap.can,
      with: buildResourceUri(SERVER_DID),
      nb: cap.nb,
    }));

    // Default expiration: 24 hours
    const exp = expiration ?? Math.floor(Date.now() / 1000) + 86400;

    const delegation = await createDelegation({
      issuer: rootSigner,
      audience,
      capabilities: fullCapabilities as any,
      expiration: exp,
    });

    const serialized = await serializeDelegation(delegation);

    res.json({
      success: true,
      delegation: serialized,
      details: {
        cid: delegation.cid.toString(),
        issuer: delegation.issuer.did(),
        audience: delegation.audience.did(),
        expiration: exp,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to create delegation',
      details: error.message,
    });
  }
});

// =============================================================================
// Start Server
// =============================================================================

initializeServer().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log('\nEndpoints:');
    console.log('  GET  /health     - Health check');
    console.log('  GET  /info       - Server info');
    console.log(
      '  POST /protected  - Protected endpoint (requires invocation)',
    );
    console.log('  POST /delegate   - Create delegation for a user');
  });
});
```

## Testing with cURL

### 1. Get server info

```bash
curl http://localhost:3000/info
```

### 2. Create a delegation

```bash
curl -X POST http://localhost:3000/delegate \
  -H "Content-Type: application/json" \
  -d '{
    "audience": "did:key:z6MkUserKey...",
    "capabilities": [{ "can": "employees/read", "nb": { "limit": 50 } }]
  }'
```

### 3. Use the delegation (invocation)

The client needs to create and sign an invocation. See [CLIENT.md](./CLIENT.md) for how to do this.

```bash
curl -X POST http://localhost:3000/protected \
  -H "Content-Type: application/json" \
  -d '{ "invocation": "<base64 CAR from client>" }'
```

## Validation Results

### Success Response

```json
{
  "message": "Access granted!",
  "invoker": "did:key:z6MkUserKey...",
  "capability": {
    "can": "employees/read",
    "with": "myapp:did:ixo:ixo1abc...",
    "nb": { "limit": 25 }
  },
  "employees": [...]
}
```

### Error Responses

**Missing invocation:**

```json
{
  "error": "Missing invocation in request body",
  "hint": "Send { \"invocation\": \"<base64 CAR>\" }"
}
```

**Invalid signature:**

```json
{
  "error": "Unauthorized",
  "details": { "code": "INVALID_SIGNATURE", "message": "..." }
}
```

**Caveat violation:**

```json
{
  "error": "Unauthorized",
  "details": {
    "code": "CAVEAT_VIOLATION",
    "message": "Cannot request limit=100, delegation only allows limit=50"
  }
}
```

**Replay attack:**

```json
{
  "error": "Unauthorized",
  "details": { "code": "REPLAY", "message": "Invocation has already been used" }
}
```

## Using with Other Frameworks

The validator is framework-agnostic. Here's how to use it with other frameworks:

### Fastify

```typescript
fastify.post('/protected', async (request, reply) => {
  const result = await validator.validate(
    request.body.invocation,
    EmployeesRead,
    'myapp:server'
  );

  if (!result.ok) {
    return reply.code(403).send({ error: result.error });
  }

  return { employees: [...] };
});
```

### Hono

```typescript
app.post('/protected', async (c) => {
  const { invocation } = await c.req.json();
  const result = await validator.validate(invocation, EmployeesRead, 'myapp:server');

  if (!result.ok) {
    return c.json({ error: result.error }, 403);
  }

  return c.json({ employees: [...] });
});
```

### NestJS

```typescript
@Controller('employees')
export class EmployeesController {
  constructor(private readonly ucanService: UCANService) {}

  @Post()
  async getEmployees(@Body('invocation') invocation: string) {
    const result = await this.ucanService.validate(invocation, EmployeesRead);

    if (!result.ok) {
      throw new ForbiddenException(result.error);
    }

    return { employees: [...] };
  }
}
```
