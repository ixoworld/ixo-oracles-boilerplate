# Client Example

How to use `@ixo/ucan` on the client-side (browser or Node.js) to create delegations and invocations.

## Installation

```bash
npm install @ixo/ucan
```

## Key Management

### Generate a New Keypair

```typescript
import { generateKeypair } from '@ixo/ucan';

const { signer, did, privateKey } = await generateKeypair();

console.log('DID:', did); // did:key:z6Mk...
console.log('Private Key:', privateKey); // MgCY... (save securely!)
```

### Parse an Existing Private Key

```typescript
import { parseSigner } from '@ixo/ucan';

const signer = parseSigner('MgCY...'); // Your stored private key
console.log('DID:', signer.did());
```

### Derive from a BIP39 Mnemonic

Useful for deriving keys from an existing wallet mnemonic:

```typescript
import { signerFromMnemonic } from '@ixo/ucan';

const { signer, did, privateKey } = await signerFromMnemonic(
  'word1 word2 word3 ...', // 12-24 word mnemonic
  'did:ixo:ixo1abc...', // Optional: override DID (e.g., for did:ixo)
);

console.log('DID:', did);
console.log('Private Key:', privateKey); // Can be used with parseSigner()
```

## Working with Delegations

### Create a Delegation

Grant capabilities to another user:

```typescript
import { createDelegation, parseSigner, serializeDelegation } from '@ixo/ucan';

// Your signer (whoever is granting the delegation)
const issuerSigner = parseSigner('MgCY...');

// Create delegation
const delegation = await createDelegation({
  issuer: issuerSigner,
  audience: 'did:key:z6MkRecipient...', // Who receives the capability
  capabilities: [
    {
      can: 'employees/read',
      with: 'myapp:company/acme',
      nb: { limit: 50 }, // Caveat: max 50 employees
    },
  ],
  expiration: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});

// Serialize for storage/transport
const serialized = await serializeDelegation(delegation);
console.log('Delegation (base64):', serialized);
```

### Parse a Delegation

Load a previously serialized delegation:

```typescript
import { parseDelegation } from '@ixo/ucan';

const delegation = await parseDelegation(serializedBase64);

console.log('CID:', delegation.cid.toString());
console.log('Issuer:', delegation.issuer.did());
console.log('Audience:', delegation.audience.did());
console.log('Capabilities:', delegation.capabilities);
console.log('Expiration:', new Date(delegation.expiration * 1000));
```

### Re-Delegate (Chain Delegations)

Pass your delegation to someone else with equal or narrower permissions:

```typescript
import { createDelegation, parseDelegation, parseSigner } from '@ixo/ucan';

// Your delegation (received from someone above you in the chain)
const myDelegation = await parseDelegation(mySerializedDelegation);

// Your signer
const mySigner = parseSigner('MgCY...');

// Re-delegate to someone else (with narrower permissions!)
const subDelegation = await createDelegation({
  issuer: mySigner,
  audience: 'did:key:z6MkSubordinate...',
  capabilities: [
    {
      can: 'employees/read',
      with: 'myapp:company/acme',
      nb: { limit: 25 }, // ⬅️ Narrower than my limit of 50
    },
  ],
  expiration: Math.floor(Date.now() / 1000) + 1800, // Shorter: 30 min
  proofs: [myDelegation], // Include proof chain
});
```

## Creating Invocations

### Create and Send an Invocation

```typescript
import {
  createInvocation,
  serializeInvocation,
  parseDelegation,
  parseSigner,
} from '@ixo/ucan';

// Load your delegation
const delegation = await parseDelegation(mySerializedDelegation);

// Your signer
const signer = parseSigner('MgCY...');

// Server's DID (from /info endpoint or known)
const serverDid = 'did:ixo:ixo1server...';

// Create invocation
const invocation = await createInvocation({
  issuer: signer,
  audience: serverDid,
  capability: {
    can: 'employees/read',
    with: 'myapp:company/acme',
    nb: { limit: 25 }, // Must be ≤ delegated limit
  },
  proofs: [delegation], // Include delegation chain
});

// Serialize
const serialized = await serializeInvocation(invocation);

// Send to server
const response = await fetch('http://server/protected', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ invocation: serialized }),
});

const result = await response.json();
console.log('Result:', result);
```

## Complete React Example

```tsx
import { useState, useCallback } from 'react';
import {
  parseDelegation,
  createInvocation,
  serializeInvocation,
  signerFromMnemonic,
} from '@ixo/ucan';

function ProtectedDataComponent() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // These would come from your app's state/storage
  const userMnemonic = '...'; // User's mnemonic (from wallet)
  const userDid = 'did:ixo:ixo1user...';
  const delegationBase64 = '...'; // Stored delegation
  const serverDid = 'did:ixo:ixo1server...';

  const fetchEmployees = useCallback(
    async (limit: number) => {
      setLoading(true);
      setError(null);

      try {
        // 1. Get user's signer from mnemonic
        const { signer } = await signerFromMnemonic(userMnemonic, userDid);

        // 2. Parse the delegation
        const delegation = await parseDelegation(delegationBase64);

        // 3. Create invocation with requested limit
        const invocation = await createInvocation({
          issuer: signer,
          audience: serverDid,
          capability: {
            can: 'employees/read',
            with: `myapp:${serverDid}`,
            nb: { limit },
          },
          proofs: [delegation],
        });

        // 4. Serialize and send
        const serialized = await serializeInvocation(invocation);

        const response = await fetch('/api/protected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invocation: serialized }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(
            err.details?.message || err.error || 'Request failed',
          );
        }

        const data = await response.json();
        setEmployees(data.employees);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [userMnemonic, userDid, delegationBase64, serverDid],
  );

  return (
    <div>
      <h2>Protected Data</h2>

      <div>
        <button onClick={() => fetchEmployees(10)} disabled={loading}>
          Fetch 10 Employees
        </button>
        <button onClick={() => fetchEmployees(25)} disabled={loading}>
          Fetch 25 Employees
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {employees.length > 0 && (
        <ul>
          {employees.map((emp) => (
            <li key={emp.id}>{emp.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## IXO Client Pattern (did:ixo + ED Mnemonic)

IXO users have a `did:ixo` identity on-chain and use a separate ED25519 mnemonic for UCAN signing. The key pattern is using `signerFromMnemonic` with the `did:ixo` to ensure the signer's identity matches.

### Using signerFromMnemonic with did:ixo

```typescript
import {
  signerFromMnemonic,
  parseDelegation,
  createInvocation,
  serializeInvocation,
  SupportedDID,
} from '@ixo/ucan';

// User's ED25519 signing mnemonic (stored/retrieved separately)
const edSigningMnemonic = 'word1 word2 word3 ...';

// User's on-chain DID
const userDid = 'did:ixo:ixo1abc123...';

// Derive signer with did:ixo identity (NOT the default did:key)
const { signer } = await signerFromMnemonic(
  edSigningMnemonic,
  userDid as SupportedDID, // ⬅️ This wraps the signer with did:ixo
);

console.log(signer.did()); // "did:ixo:ixo1abc123..." (not did:key!)
```

### Complete Invocation Example

```typescript
import {
  signerFromMnemonic,
  parseDelegation,
  createInvocation,
  serializeInvocation,
  SupportedDID,
} from '@ixo/ucan';

async function invokeWithIxoDid(
  edSigningMnemonic: string, // User's ED mnemonic
  userDid: string, // User's did:ixo
  delegationBase64: string, // Stored delegation
  serverDid: string, // Server's DID
  requestedLimit: number,
) {
  // 1. Derive signer with did:ixo identity
  const { signer } = await signerFromMnemonic(
    edSigningMnemonic,
    userDid as SupportedDID,
  );

  // 2. Parse the delegation for proof
  const delegation = await parseDelegation(delegationBase64);

  // 3. Create invocation
  const invocation = await createInvocation({
    issuer: signer,
    audience: serverDid,
    capability: {
      can: 'employees/read',
      with: `myapp:${serverDid}`,
      nb: { limit: requestedLimit },
    },
    proofs: [delegation],
  });

  // 4. Serialize and send
  const serialized = await serializeInvocation(invocation);

  const response = await fetch('http://server/protected', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invocation: serialized }),
  });

  return response.json();
}
```

### Key Points

1. **Always pass `did:ixo` to `signerFromMnemonic`** - Without it, the signer defaults to `did:key` which won't match your delegation audience.

2. **The ED mnemonic is separate from wallet mnemonic** - IXO uses a dedicated ED25519 mnemonic for UCAN signing, not the main wallet mnemonic.

3. **Cast to `SupportedDID`** - TypeScript requires `userDid as SupportedDID` for type safety.

## Storing Delegations

Delegations should be stored securely. Options include:

### Browser LocalStorage (development only)

```typescript
// Store
localStorage.setItem('ucan-delegation', serializedDelegation);

// Load
const delegation = await parseDelegation(
  localStorage.getItem('ucan-delegation'),
);
```

## Error Handling

```typescript
try {
  const result = await validator.validate(invocation, capability, resource);

  if (!result.ok) {
    switch (result.error?.code) {
      case 'INVALID_FORMAT':
        // Malformed invocation
        break;
      case 'INVALID_SIGNATURE':
        // Bad signature
        break;
      case 'UNAUTHORIZED':
        // No valid delegation chain
        break;
      case 'CAVEAT_VIOLATION':
        // Exceeded limits
        break;
      case 'REPLAY':
        // Already used
        break;
      case 'EXPIRED':
        // Delegation expired
        break;
    }
  }
} catch (err) {
  console.error('Unexpected error:', err);
}
```

## Tips

1. **Store private keys securely** - Never expose private keys in client code or logs
2. **Handle expiration** - Check delegation expiration before using; refresh if needed
3. **Use appropriate limits** - Don't request more than you need
4. **Bundle proofs** - Always include the full delegation chain in invocations
5. **Verify server DID** - Make sure `audience` matches the actual server DID
