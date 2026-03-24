import { describe, expect, it } from 'vitest';
import * as Client from '@ucanto/client';
import { ed25519 } from '@ucanto/principal';
import { createUCANValidator } from './validator.js';
import { defineCapability, Schema } from '../capabilities/capability.js';
import {
  createDelegation,
  createInvocation,
  serializeDelegation,
  serializeInvocation,
  type Capability,
} from '../client/create-client.js';

/**
 * Helper: generate an ed25519 keypair
 */
async function keygen() {
  const signer = await ed25519.Signer.generate();
  return { signer, did: signer.did() };
}

/**
 * Simple capability without caveats
 */
const TestRead = defineCapability({
  can: 'test/read',
  protocol: 'ixo:',
});

/**
 * Capability with limit caveat
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

describe('UCAN Validator', () => {
  describe('proofChain', () => {
    it('should return single-element chain for direct root invocation', async () => {
      const server = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const invocation = Client.invoke({
        issuer: root.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: `ixo:resource:123` as const,
        },
        proofs: [],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.proofChain).toEqual([root.did]);
    });

    it('should return two-element chain for root -> user delegation', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegation = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
      });

      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.proofChain).toEqual([root.did, user.did]);
    });

    it('should return three-element chain for root -> alice -> bob', async () => {
      const server = await keygen();
      const root = await keygen();
      const alice = await keygen();
      const bob = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const rootToAlice = await Client.delegate({
        issuer: root.signer,
        audience: alice.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
      });

      const aliceToBob = await Client.delegate({
        issuer: alice.signer,
        audience: bob.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
        proofs: [rootToAlice],
      });

      const invocation = Client.invoke({
        issuer: bob.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [aliceToBob],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.proofChain).toEqual([root.did, alice.did, bob.did]);
    });
  });

  describe('expiration', () => {
    it('should return undefined expiration when no expiration is set (Infinity)', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Using createDelegation/createInvocation which default to Infinity
      const delegation = await createDelegation({
        issuer: root.signer,
        audience: user.did,
        capabilities: [
          {
            can: 'test/read' as Capability['can'],
            with: 'ixo:resource:123' as Capability['with'],
          },
        ],
      });

      const invocation = await createInvocation({
        issuer: user.signer,
        audience: server.did,
        capability: {
          can: 'test/read' as Capability['can'],
          with: 'ixo:resource:123' as Capability['with'],
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      // No expiration set → defaults to Infinity → filtered out
      expect(result.expiration).toBeUndefined();
    });

    it('should return delegation expiration when set', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegation = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
        expiration: futureExp,
      });

      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.expiration).toBeDefined();
      expect(result.expiration).toBeLessThanOrEqual(futureExp);
    });

    it('should return earliest expiration across the chain', async () => {
      const server = await keygen();
      const root = await keygen();
      const alice = await keygen();
      const bob = await keygen();

      const laterExp = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      const earlierExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Root -> Alice with later expiration
      const rootToAlice = await Client.delegate({
        issuer: root.signer,
        audience: alice.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
        expiration: laterExp,
      });

      // Alice -> Bob with earlier expiration
      const aliceToBob = await Client.delegate({
        issuer: alice.signer,
        audience: bob.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
        expiration: earlierExp,
        proofs: [rootToAlice],
      });

      const invocation = Client.invoke({
        issuer: bob.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [aliceToBob],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.expiration).toBeDefined();
      // Should be the earlier expiration (alice->bob's 1 hour, not root->alice's 2 hours)
      expect(result.expiration).toBeLessThanOrEqual(earlierExp);
    });
  });

  describe('validation failures', () => {
    it('should reject malformed base64 input', async () => {
      const server = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const result = await validator.validate(
        'not-valid-base64!!!',
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('INVALID_FORMAT');
    });

    it('should reject invocation with wrong audience', async () => {
      const server = await keygen();
      const wrongServer = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Invocation addressed to wrong server
      const invocation = Client.invoke({
        issuer: root.signer,
        audience: ed25519.Verifier.parse(wrongServer.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should reject invocation with untrusted root', async () => {
      const server = await keygen();
      const trustedRoot = await keygen();
      const untrustedRoot = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [trustedRoot.did], // Only trustedRoot is trusted
      });

      // Delegation from untrusted root
      const delegation = await Client.delegate({
        issuer: untrustedRoot.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
      });

      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should reject invocation with mismatched resource', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegation = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'test/read' as const,
            with: 'ixo:resource:123' as const,
          },
        ],
      });

      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      // Validate against a different resource than what was delegated
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:999',
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('caveat validation', () => {
    it('should pass when caveats are within bounds', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const resource = `myapp:${server.did}` as const;

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegation = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'employees/read' as const,
            with: resource,
            nb: { limit: 50 },
          },
        ],
      });

      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'employees/read' as const,
          with: resource,
          nb: { limit: 25 },
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        EmployeesRead,
        resource,
      );

      expect(result.ok).toBe(true);
      expect(result.capability?.nb?.limit).toBe(25);
    });

    it('should reject when caveats exceed delegated bounds', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const resource = `myapp:${server.did}` as const;

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegation = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: 'employees/read' as const,
            with: resource,
            nb: { limit: 25 },
          },
        ],
      });

      // User tries to exceed their limit
      const invocation = Client.invoke({
        issuer: user.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'employees/read' as const,
          with: resource,
          nb: { limit: 100 },
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        EmployeesRead,
        resource,
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('CAVEAT_VIOLATION');
    });
  });

  describe('facts', () => {
    it('should return facts attached to the invocation', async () => {
      const server = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const facts = [
        { verified: true, timestamp: 1234567890 },
        { service: 'oracle', version: '1.0' },
      ];

      const invocation = Client.invoke({
        issuer: root.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        facts,
        proofs: [],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.facts).toBeDefined();
      expect(result.facts).toHaveLength(2);
      expect(result.facts).toEqual(facts);
    });

    it('should return undefined facts when none are attached', async () => {
      const server = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const invocation = Client.invoke({
        issuer: root.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.facts).toBeUndefined();
    });

    it('should pass facts through createInvocation helper', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const facts = [{ requestId: 'abc-123', origin: 'portal' }];

      const delegation = await createDelegation({
        issuer: root.signer,
        audience: user.did,
        capabilities: [
          {
            can: 'test/read' as Capability['can'],
            with: 'ixo:resource:123' as Capability['with'],
          },
        ],
      });

      const invocation = await createInvocation({
        issuer: user.signer,
        audience: server.did,
        capability: {
          can: 'test/read' as Capability['can'],
          with: 'ixo:resource:123' as Capability['with'],
        },
        proofs: [delegation],
        facts,
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      expect(result.facts).toEqual(facts);
    });

    it('should pass facts through createDelegation helper', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const delegationFacts = [{ purpose: 'oracle-access', level: 'standard' }];

      const delegation = await createDelegation({
        issuer: root.signer,
        audience: user.did,
        capabilities: [
          {
            can: 'test/read' as Capability['can'],
            with: 'ixo:resource:123' as Capability['with'],
          },
        ],
        facts: delegationFacts,
      });

      // Verify facts are on the delegation itself
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((delegation as any).facts).toEqual(delegationFacts);

      // Invocation without facts — facts on delegation don't propagate to result
      const invocation = await createInvocation({
        issuer: user.signer,
        audience: server.did,
        capability: {
          can: 'test/read' as Capability['can'],
          with: 'ixo:resource:123' as Capability['with'],
        },
        proofs: [delegation],
      });

      const serialized = await serializeInvocation(invocation);
      const result = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );

      expect(result.ok).toBe(true);
      // Result facts come from the invocation, not the delegation
      expect(result.facts).toBeUndefined();
    });
  });

  describe('replay protection', () => {
    it('should reject replayed invocations', async () => {
      const server = await keygen();
      const root = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      const invocation = Client.invoke({
        issuer: root.signer,
        audience: ed25519.Verifier.parse(server.did),
        capability: {
          can: 'test/read' as const,
          with: 'ixo:resource:123' as const,
        },
        proofs: [],
      });

      const serialized = await serializeInvocation(invocation);

      // First validation should pass
      const result1 = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );
      expect(result1.ok).toBe(true);

      // Second validation (replay) should fail
      const result2 = await validator.validate(
        serialized,
        TestRead,
        'ixo:resource:123',
      );
      expect(result2.ok).toBe(false);
      expect(result2.error?.code).toBe('REPLAY');
    });
  });

  describe('validateDelegation', () => {
    it('should validate a simple delegation with did:key', async () => {
      const server = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [user.did],
      });

      const delegation = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: Math.floor(Date.now() / 1000) + 3600,
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(true);
      expect(result.invoker).toBe(user.did);
      expect(result.capability?.can).toBe('*');
      expect(result.capability?.with).toBe('ixo:oracle');
      expect(result.proofChain).toEqual([user.did]);
    });

    it('should validate a delegation with non-did:key issuer (withDID)', async () => {
      const server = await keygen();
      const userKey = await keygen();
      // Simulate a did:ixo issuer (signer with overridden DID)
      const ixoDid = 'did:ixo:ixo1testuser123' as const;
      const signer = userKey.signer.withDID(ixoDid);

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [ixoDid],
        // Provide a resolver that maps did:ixo -> did:key
        didResolver: async (did) => {
          if (did === ixoDid) return { ok: [userKey.did] };
          return { error: { name: 'NotFound', did, message: 'Unknown DID' } };
        },
      });

      const delegation = await createDelegation({
        issuer: signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: Math.floor(Date.now() / 1000) + 3600,
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(true);
      expect(result.invoker).toBe(ixoDid);
      expect(result.proofChain).toEqual([ixoDid]);
    });

    it('should reject delegation with wrong audience', async () => {
      const server = await keygen();
      const wrongServer = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [user.did],
      });

      const delegation = await createDelegation({
        issuer: user.signer,
        audience: wrongServer.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should reject expired delegation', async () => {
      const server = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [user.did],
      });

      const delegation = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: Math.floor(Date.now() / 1000) - 60, // expired 1 minute ago
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('EXPIRED');
    });

    it('should reject delegation with tampered signature', async () => {
      const server = await keygen();
      const user = await keygen();
      const attacker = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [user.did],
      });

      // Attacker creates delegation pretending to be user
      // but signing with their own key (signature won't match user's DID)
      const delegation = await createDelegation({
        issuer: attacker.signer.withDID(user.did),
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: Math.floor(Date.now() / 1000) + 3600,
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject malformed base64 input', async () => {
      const server = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [],
      });

      const result = await validator.validateDelegation('not-valid-base64!!!');

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('INVALID_FORMAT');
    });

    it('should validate delegation chain (root -> user -> server)', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Root delegates to user
      const rootToUser = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: '*' as const,
            with: 'ixo:oracle' as const,
          },
        ],
        expiration: Math.floor(Date.now() / 1000) + 7200,
      });

      // User re-delegates to server (with proof of root delegation)
      const userToServer = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: Math.floor(Date.now() / 1000) + 3600,
        proofs: [rootToUser],
      });

      const serialized = await serializeDelegation(userToServer);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(true);
      expect(result.invoker).toBe(user.did);
      expect(result.proofChain).toEqual([root.did, user.did]);
    });

    it('should return effective expiration across delegation chain', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();

      const laterExp = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      const earlierExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Root -> user with later expiration
      const rootToUser = await Client.delegate({
        issuer: root.signer,
        audience: user.signer,
        capabilities: [
          {
            can: '*' as const,
            with: 'ixo:oracle' as const,
          },
        ],
        expiration: laterExp,
      });

      // User -> server with earlier expiration
      const userToServer = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        expiration: earlierExp,
        proofs: [rootToUser],
      });

      const serialized = await serializeDelegation(userToServer);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(true);
      expect(result.expiration).toBeDefined();
      expect(result.expiration).toBeLessThanOrEqual(earlierExp);
    });

    it('should reject delegation with broken proof chain', async () => {
      const server = await keygen();
      const root = await keygen();
      const user = await keygen();
      const unrelated = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [root.did],
      });

      // Root delegates to an unrelated party (not user)
      const rootToUnrelated = await Client.delegate({
        issuer: root.signer,
        audience: unrelated.signer,
        capabilities: [
          {
            can: '*' as const,
            with: 'ixo:oracle' as const,
          },
        ],
      });

      // User tries to use unrelated's delegation as proof (audience mismatch)
      const userToServer = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        proofs: [rootToUnrelated],
      });

      const serialized = await serializeDelegation(userToServer);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should return undefined expiration for non-expiring delegation', async () => {
      const server = await keygen();
      const user = await keygen();

      const validator = await createUCANValidator({
        serverDid: server.did,
        rootIssuers: [user.did],
      });

      const delegation = await createDelegation({
        issuer: user.signer,
        audience: server.did,
        capabilities: [
          {
            can: '*' as Capability['can'],
            with: 'ixo:oracle' as Capability['with'],
          },
        ],
        // No expiration = Infinity = no effective expiration
      });

      const serialized = await serializeDelegation(delegation);
      const result = await validator.validateDelegation(serialized);

      expect(result.ok).toBe(true);
      expect(result.expiration).toBeUndefined();
    });
  });
});
