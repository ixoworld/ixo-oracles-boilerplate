/**
 * UCAN Test Script
 *
 * Run with: pnpm test:ucan
 *
 * Change the ACTION variable to test different things:
 * - 'generate-keys'     : Generate new keypairs for testing
 * - 'create-delegation' : Create a delegation from Root to User
 * - 'full-flow'         : Full flow with caveat validation (Root -> Alice -> Bob)
 * - 'validate'          : Test the validator with a simple invocation
 */

import { ed25519 } from '@ucanto/principal';
import * as Client from '@ucanto/client';
import {
  defineCapability,
  Schema,
  createUCANValidator,
  serializeInvocation,
} from '../src/index.js';

// ============================================================================
// CONFIGURATION - Change this to test different scenarios
// ============================================================================

const ACTION:
  | 'generate-keys'
  | 'create-delegation'
  | 'full-flow'
  | 'validate' = 'full-flow';

// ============================================================================
// CAPABILITY DEFINITION
// ============================================================================

/**
 * EmployeesRead capability with limit caveat
 * - The limit specifies max number of employees that can be read
 * - Delegations can only attenuate (reduce) the limit, never increase it
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

// ============================================================================
// HELPERS
// ============================================================================

function log(title: string, data?: unknown) {
  console.log('\n' + '─'.repeat(70));
  console.log(`│ ${title}`);
  console.log('─'.repeat(70));
  if (data !== undefined) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

function success(msg: string) {
  console.log(`   ✅ ${msg}`);
}

function fail(msg: string) {
  console.log(`   ❌ ${msg}`);
}

function info(msg: string) {
  console.log(`   ℹ️  ${msg}`);
}

function buildResourceUri(serverDid: string): `myapp:${string}` {
  return `myapp:${serverDid}`;
}

// ============================================================================
// ACTION: Generate Keys
// ============================================================================

async function generateKeys() {
  log('Generating New Keypair');

  const signer = await ed25519.Signer.generate();
  const did = signer.did();
  const privateKey = ed25519.Signer.format(signer);

  console.log(JSON.stringify({
    did,
    privateKey,
    note: 'Save the privateKey securely! The DID is public.',
  }, null, 2));

  return { signer, did, privateKey };
}

// ============================================================================
// ACTION: Create Single Delegation
// ============================================================================

async function createSingleDelegation() {
  log('Creating Delegation: Root -> User');

  const root = await ed25519.Signer.generate();
  const user = await ed25519.Signer.generate();
  const server = await ed25519.Signer.generate();

  console.log('\nRoot (Admin):');
  console.log(`  DID: ${root.did()}`);
  console.log(`  Private Key: ${ed25519.Signer.format(root)}`);

  console.log('\nUser (Delegate):');
  console.log(`  DID: ${user.did()}`);
  console.log(`  Private Key: ${ed25519.Signer.format(user)}`);

  console.log('\nServer:');
  console.log(`  DID: ${server.did()}`);

  // Create delegation
  const delegation = await Client.delegate({
    issuer: root,
    audience: user,
    capabilities: [
      {
        can: 'employees/read' as const,
        with: buildResourceUri(server.did()),
        nb: { limit: 100 },
      },
    ],
    expiration: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  });

  console.log('\nDelegation Created:');
  console.log(`  CID: ${delegation.cid.toString()}`);
  console.log(`  Issuer: ${delegation.issuer.did()}`);
  console.log(`  Audience: ${delegation.audience.did()}`);
  console.log(`  Capabilities: ${JSON.stringify(delegation.capabilities)}`);

  // Serialize
  const archive = await delegation.archive();
  if ('error' in archive && archive.error) {
    throw archive.error;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serialized = Buffer.from((archive as any).ok).toString('base64');

  console.log('\nSerialized (base64):');
  console.log(`  ${serialized.slice(0, 80)}...`);

  return { root, user, server, delegation, serialized };
}

// ============================================================================
// ACTION: Full Flow with Caveat Validation
// ============================================================================

async function fullFlow() {
  console.log('\n🔐 UCAN FULL FLOW TEST - With Caveat Validation\n');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Setup - Generate all parties
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 1: Setup - Generate Parties');

  const server = await ed25519.Signer.generate();
  const root = await ed25519.Signer.generate();
  const alice = await ed25519.Signer.generate();
  const bob = await ed25519.Signer.generate();

  console.log(`   Server DID: ${server.did().slice(0, 40)}...`);
  console.log(`   Root DID:   ${root.did().slice(0, 40)}...`);
  console.log(`   Alice DID:  ${alice.did().slice(0, 40)}...`);
  console.log(`   Bob DID:    ${bob.did().slice(0, 40)}...`);

  // Create validator (async to support non-did:key server DIDs)
  const validator = await createUCANValidator({
    serverDid: server.did(),
    rootIssuers: [root.did()],
  });

  info('Validator created with Root as the only root issuer');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Root delegates to Alice with limit: 50
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 2: Root delegates to Alice (limit: 50)');

  const rootToAlice = await Client.delegate({
    issuer: root,
    audience: alice,
    capabilities: [
      {
        can: 'employees/read' as const,
        with: buildResourceUri(server.did()),
        nb: { limit: 50 },
      },
    ],
    expiration: Math.floor(Date.now() / 1000) + 3600,
  });

  success(`Delegation created: ${rootToAlice.cid.toString().slice(0, 20)}...`);
  info('Alice can now read up to 50 employees');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Alice re-delegates to Bob with limit: 25 (attenuated)
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 3: Alice re-delegates to Bob (limit: 25 - attenuated)');

  const aliceToBob = await Client.delegate({
    issuer: alice,
    audience: bob,
    capabilities: [
      {
        can: 'employees/read' as const,
        with: buildResourceUri(server.did()),
        nb: { limit: 25 }, // Alice restricts Bob further
      },
    ],
    expiration: Math.floor(Date.now() / 1000) + 3600,
    proofs: [rootToAlice], // Include proof from Root
  });

  success(`Delegation created: ${aliceToBob.cid.toString().slice(0, 20)}...`);
  info('Bob can now read up to 25 employees (attenuated from Alice\'s 50)');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Alice invokes with limit: 50 (should succeed)
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 4: Alice invokes with limit: 50');
  info('Alice tries to read 50 employees (her full allowance)');

  const aliceInvocation = Client.invoke({
    issuer: alice,
    audience: server,
    capability: {
      can: 'employees/read' as const,
      with: buildResourceUri(server.did()),
      nb: { limit: 50 },
    },
    proofs: [rootToAlice],
  });

  const aliceSerialized = await serializeInvocation(aliceInvocation);

  const aliceResult = await validator.validate(
    aliceSerialized,
    EmployeesRead,
    buildResourceUri(server.did()),
  );

  if (aliceResult.ok) {
    success('Alice\'s invocation PASSED');
    console.log(`   Requested: ${aliceResult.capability?.nb?.limit} employees`);
  } else {
    fail(`Alice's invocation failed unexpectedly: ${aliceResult.error?.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Bob tries to invoke with limit: 30 (should FAIL - exceeds his 25)
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 5: Bob tries to invoke with limit: 30 (SHOULD FAIL)');
  info('Bob tries to read 30 employees but only has allowance for 25');

  const bobBadInvocation = Client.invoke({
    issuer: bob,
    audience: server,
    capability: {
      can: 'employees/read' as const,
      with: buildResourceUri(server.did()),
      nb: { limit: 30 }, // Exceeds his limit of 25!
    },
    proofs: [aliceToBob],
  });

  const bobBadSerialized = await serializeInvocation(bobBadInvocation);

  const bobBadResult = await validator.validate(
    bobBadSerialized,
    EmployeesRead,
    buildResourceUri(server.did()),
  );

  if (!bobBadResult.ok) {
    success('Bob\'s excessive request correctly REJECTED');
    console.log(`   Error: ${bobBadResult.error?.message}`);
    console.log(`   Code: ${bobBadResult.error?.code}`);
  } else {
    fail('Bob\'s excessive request should have been rejected!');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 6: Bob invokes with limit: 20 (should succeed - within his 25)
  // ─────────────────────────────────────────────────────────────────────────
  log('STEP 6: Bob invokes with limit: 20 (should succeed)');
  info('Bob tries to read 20 employees (within his allowance of 25)');

  const bobGoodInvocation = Client.invoke({
    issuer: bob,
    audience: server,
    capability: {
      can: 'employees/read' as const,
      with: buildResourceUri(server.did()),
      nb: { limit: 20 }, // Within his limit
    },
    proofs: [aliceToBob],
  });

  const bobGoodSerialized = await serializeInvocation(bobGoodInvocation);

  const bobGoodResult = await validator.validate(
    bobGoodSerialized,
    EmployeesRead,
    buildResourceUri(server.did()),
  );

  if (bobGoodResult.ok) {
    success('Bob\'s valid request PASSED');
    console.log(`   Requested: ${bobGoodResult.capability?.nb?.limit} employees`);
    console.log(`   Invoker: ${bobGoodResult.invoker?.slice(0, 40)}...`);
  } else {
    fail(`Bob's valid request failed unexpectedly: ${bobGoodResult.error?.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  log('SUMMARY');

  console.log(`
┌───────────────────────────────────────────────────────────────────────┐
│                     UCAN DELEGATION CHAIN                             │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ROOT (Admin)                                                        │
│   └─ delegates to Alice: employees/read (limit: 50)                   │
│                                                                       │
│   ALICE (Team Lead)                                                   │
│   ├─ invokes: limit=50 ✅ PASSED (within her allowance)               │
│   └─ re-delegates to Bob: employees/read (limit: 25)                  │
│                                                                       │
│   BOB (Employee)                                                      │
│   ├─ invokes: limit=30 ❌ REJECTED (exceeds his 25 allowance)         │
│   └─ invokes: limit=20 ✅ PASSED (within his 25 allowance)            │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│   KEY INSIGHT: Caveats can only be attenuated (made stricter),        │
│   never amplified. Bob cannot exceed Alice's restriction of 25,       │
│   and Alice cannot exceed Root's restriction of 50.                   │
└───────────────────────────────────────────────────────────────────────┘
`);
}

// ============================================================================
// ACTION: Test Validator
// ============================================================================

async function testValidate() {
  log('TEST VALIDATOR', 'Create invocation and validate it');

  // Setup
  const server = await ed25519.Signer.generate();
  const root = await ed25519.Signer.generate();
  const user = await ed25519.Signer.generate();

  console.log('\nSetup:');
  console.log(`  Server: ${server.did().slice(0, 50)}...`);
  console.log(`  Root: ${root.did().slice(0, 50)}...`);
  console.log(`  User: ${user.did().slice(0, 50)}...`);

  // Create validator (async to support non-did:key server DIDs)
  const validator = await createUCANValidator({
    serverDid: server.did(),
    rootIssuers: [root.did()],
  });

  // Root delegates to user
  const delegation = await Client.delegate({
    issuer: root,
    audience: user,
    capabilities: [
      {
        can: 'employees/read' as const,
        with: buildResourceUri(server.did()),
      },
    ],
  });

  console.log(`\nDelegation: ${delegation.cid.toString().slice(0, 30)}...`);

  // User creates invocation
  const invocation = Client.invoke({
    issuer: user,
    audience: server,
    capability: {
      can: 'employees/read' as const,
      with: buildResourceUri(server.did()),
    },
    proofs: [delegation],
  });

  const serialized = await serializeInvocation(invocation);

  console.log(`Invocation created`);
  console.log(`Serialized length: ${serialized.length} bytes`);

  // Validate it
  const result = await validator.validate(
    serialized,
    EmployeesRead,
    buildResourceUri(server.did()),
  );

  console.log('\nValidation Result:');
  console.log(JSON.stringify(result, null, 2));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n🔐 UCAN Test Script\n');
  console.log(`Action: ${ACTION}`);

  switch (ACTION) {
    case 'generate-keys':
      await generateKeys();
      break;
    case 'create-delegation':
      await createSingleDelegation();
      break;
    case 'full-flow':
      await fullFlow();
      break;
    case 'validate':
      await testValidate();
      break;
    default:
      console.error('Unknown action:', ACTION);
  }

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
