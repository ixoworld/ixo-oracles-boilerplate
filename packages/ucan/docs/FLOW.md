# UCAN Flow: Delegation, Attenuation & Invocation

This document explains how UCAN authorization works with visual diagrams.

## The Players

```
  👑 ROOT                    👩 ALICE                    👤 BOB
  ─────────────────          ──────────────────          ─────────────────
  Resource Owner             Gets limit: 50              Gets limit: 25
  Full authority             Can delegate further        Can only use, not expand
```

## The Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UCAN DELEGATION CHAIN                             │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────┐
                    │          ROOT               │
                    │     (Resource Owner)        │
                    │   can: employees/read       │
                    │   with: myapp:company       │
                    │   limit: ∞ (unlimited)      │
                    └─────────────┬───────────────┘
                                  │
                                  │ DELEGATES (limit: 50)
                                  ▼
                    ┌─────────────────────────────┐
                    │          ALICE              │
                    │      (Team Lead)            │
                    │   can: employees/read       │
                    │   with: myapp:company       │
                    │   limit: 50                 │
                    └─────────────┬───────────────┘
                                  │
                                  │ RE-DELEGATES (limit: 25)
                                  │ ← Attenuated! (narrower)
                                  ▼
                    ┌─────────────────────────────┐
                    │           BOB               │
                    │       (Employee)            │
                    │   can: employees/read       │
                    │   with: myapp:company       │
                    │   limit: 25                 │
                    └─────────────────────────────┘
```

## Delegation Structure

When Root delegates to Alice:

```
┌────────────────────────────────────────────┐
│  DELEGATION #1                             │
│  ──────────────────────────────────────    │
│  issuer:    did:key:root                   │
│  audience:  did:key:alice                  │
│  can:       "employees/read"               │
│  with:      "myapp:company"                │
│  nb:        { limit: 50 }                  │
│  expires:   2025-12-31                     │
│  proofs:    []  ← Root needs no proof      │
│  ──────────────────────────────────────    │
│  signature: <Root's signature>             │
└────────────────────────────────────────────┘
```

When Alice re-delegates to Bob:

```
┌────────────────────────────────────────────┐
│  DELEGATION #2                             │
│  ──────────────────────────────────────    │
│  issuer:    did:key:alice                  │
│  audience:  did:key:bob                    │
│  can:       "employees/read"               │
│  with:      "myapp:company"                │
│  nb:        { limit: 25 }  ← NARROWED!     │
│  expires:   2025-06-30     ← SHORTER!      │
│  proofs:    [DELEGATION #1] ← Chain        │
│  ──────────────────────────────────────    │
│  signature: <Alice's signature>            │
└────────────────────────────────────────────┘
```

## Invocation & Validation

When Bob wants to use his capability:

```
┌────────────────────────────────────────────┐
│  INVOCATION (Bob's Request)                │
│  ──────────────────────────────────────    │
│  issuer:    did:key:bob                    │
│  audience:  did:key:server                 │
│  can:       "employees/read"               │
│  with:      "myapp:company"                │
│  nb:        { limit: 20 }  ← Request       │
│  proofs:    [DELEGATION #2]                │
│  ──────────────────────────────────────    │
│  signature: <Bob's signature>              │
└────────────────────────────────────────────┘
          │
          │ Sent to Server
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVER VALIDATION                         │
├─────────────────────────────────────────────────────────────┤
│  1. ✅ Verify Bob's signature on invocation                 │
│  2. ✅ Check invocation audience = server DID               │
│  3. ✅ Extract DELEGATION #2 from proofs                    │
│  4. ✅ Verify Alice's signature on DELEGATION #2            │
│  5. ✅ Check DELEGATION #2.audience = Bob (invoker)         │
│  6. ✅ Extract DELEGATION #1 from DELEGATION #2.proofs      │
│  7. ✅ Verify Root's signature on DELEGATION #1             │
│  8. ✅ Check DELEGATION #1.audience = Alice                 │
│  9. ✅ Root is trusted root issuer                          │
│ 10. ✅ Caveat check: 20 ≤ 25 (Bob's limit)                  │
│ 11. ✅ Caveat check: 25 ≤ 50 (Alice's limit)                │
│ 12. ✅ CID not in replay store                              │
│ 13. ✅ Not expired                                          │
├─────────────────────────────────────────────────────────────┤
│                      ACCESS GRANTED ✅                       │
└─────────────────────────────────────────────────────────────┘
```

## Attenuation Rules

**Key Principle**: You can only delegate ≤ what you have.

```
┌────────────────────────────────────────────────────────────────────┐
│                         ATTENUATION RULES                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ✅ ALLOWED (Narrowing):                                           │
│     • limit: 50 → limit: 25  (smaller)                             │
│     • expires: Dec → expires: June  (shorter)                      │
│     • with: "myapp:*" → with: "myapp:company"  (more specific)     │
│                                                                    │
│  ❌ FORBIDDEN (Escalation):                                        │
│     • limit: 25 → limit: 50  (larger)                              │
│     • expires: June → expires: Dec  (longer)                       │
│     • with: "myapp:company" → with: "myapp:*"  (broader)           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## What Each Party Can Do

```
┌─────────────────────────────────────────────────────────────────┐
│  Action                    │  Root  │  Alice  │  Bob            │
├─────────────────────────────────────────────────────────────────┤
│  Read 100 employees        │   ✅   │   ❌    │   ❌            │
│  Read 50 employees         │   ✅   │   ✅    │   ❌            │
│  Read 25 employees         │   ✅   │   ✅    │   ✅            │
│  Delegate limit: 50        │   ✅   │   ✅    │   ❌            │
│  Delegate limit: 25        │   ✅   │   ✅    │   ✅            │
│  Delegate limit: 10        │   ✅   │   ✅    │   ✅            │
└─────────────────────────────────────────────────────────────────┘
```

## Self-Contained Invocations

Invocations bundle their entire proof chain:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  INVOCATION PAYLOAD (self-contained)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Bob's Invocation                                                      │
│   └── proofs: [ DELEGATION #2 ]                                         │
│                └── Alice's Delegation to Bob                            │
│                    └── proofs: [ DELEGATION #1 ]                        │
│                                 └── Root's Delegation to Alice          │
│                                     └── proofs: []  (root!)             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**

- Server doesn't need external delegation store
- Validation is entirely local
- No network calls during validation (except DID resolution)

## Replay Protection

Each invocation has a unique CID. The server stores used CIDs:

```
┌──────────────────────────────────────────────────────────────┐
│                    REPLAY PROTECTION                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  First request:                                              │
│    Invocation CID: bafy...abc                                │
│    → Not in store → PROCESS → Add to store ✅                │
│                                                              │
│  Replay attempt:                                             │
│    Invocation CID: bafy...abc  (same!)                       │
│    → Already in store → REJECT ❌                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Code Example

```typescript
import {
  defineCapability,
  createUCANValidator,
  createDelegation,
  createInvocation,
  Schema,
} from '@ixo/ucan';

// 1. Define capability with caveat
const EmployeesRead = defineCapability({
  can: 'employees/read',
  protocol: 'myapp:',
  nb: { limit: Schema.integer().optional() },
  derives: (claimed, delegated) => {
    const claimedLimit = claimed.nb?.limit ?? Infinity;
    const delegatedLimit = delegated.nb?.limit ?? Infinity;
    if (claimedLimit > delegatedLimit) {
      return { error: new Error('Limit exceeds delegation') };
    }
    return { ok: {} };
  },
});

// 2. Root delegates to Alice with limit: 50
const rootToAlice = await createDelegation({
  issuer: rootSigner,
  audience: aliceDid,
  capabilities: [
    { can: 'employees/read', with: 'myapp:company', nb: { limit: 50 } },
  ],
});

// 3. Alice re-delegates to Bob with limit: 25
const aliceToBob = await createDelegation({
  issuer: aliceSigner,
  audience: bobDid,
  capabilities: [
    { can: 'employees/read', with: 'myapp:company', nb: { limit: 25 } },
  ],
  proofs: [rootToAlice], // Include proof chain
});

// 4. Bob invokes with limit: 20
const invocation = await createInvocation({
  issuer: bobSigner,
  audience: serverDid,
  capability: {
    can: 'employees/read',
    with: 'myapp:company',
    nb: { limit: 20 },
  },
  proofs: [aliceToBob], // Includes entire chain
});

// 5. Server validates
const result = await validator.validate(
  serialized,
  EmployeesRead,
  'myapp:company',
);
// result.ok === true, result.capability.nb.limit === 20
```

## Summary

| Concept               | Description                                        |
| --------------------- | -------------------------------------------------- |
| **Delegation**        | Granting capabilities to others (signed by issuer) |
| **Attenuation**       | Narrowing permissions when re-delegating           |
| **Invocation**        | Request to use a capability (signed by invoker)    |
| **Proof Chain**       | Delegations linked together, bundled in invocation |
| **Caveat**            | Restrictions on capabilities (e.g., `limit`)       |
| **Replay Protection** | CID-based tracking prevents reuse                  |
