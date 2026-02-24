/* eslint-disable no-console */
/**
 * @fileoverview Framework-agnostic UCAN validator
 *
 * This module provides a simple validator that can be used in any
 * server framework (Express, Fastify, Hono, raw Node HTTP, etc.)
 * to validate UCAN invocations.
 *
 * Uses ucanto's battle-tested validation under the hood.
 *
 * Supports any DID method (did:key, did:ixo, did:web, etc.) for the server identity.
 * Non-did:key DIDs are resolved at startup using the provided didResolver.
 */

import { ed25519 } from '@ucanto/principal';
import { Delegation } from '@ucanto/core';
import { claim } from '@ucanto/validator';
import { type capability } from '@ucanto/validator';
import type { DIDKeyResolver, InvocationStore } from '../types.js';
import { InMemoryInvocationStore } from '../store/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CapabilityParser = ReturnType<typeof capability<any, any, any>>;

type Verifier = ReturnType<typeof ed25519.Verifier.parse>;

/**
 * Options for creating a UCAN validator
 */
export interface CreateValidatorOptions {
  /**
   * The server's DID (audience for invocations)
   * Invocations must be addressed to this DID.
   *
   * Supports any DID method:
   * - did:key:z6Mk... (parsed directly)
   * - did:ixo:ixo1... (resolved using didResolver at startup)
   * - did:web:example.com (resolved using didResolver at startup)
   */
  serverDid: string;

  /**
   * DIDs that are allowed to be root issuers
   * These DIDs can self-issue capabilities without needing a delegation chain
   */
  rootIssuers: string[];

  /**
   * DID resolver for non-did:key DIDs.
   * Required if serverDid or any issuer uses a non-did:key method.
   *
   * The resolver should return the did:key(s) associated with the DID.
   */
  didResolver?: DIDKeyResolver;

  /**
   * Optional invocation store for replay protection
   * If not provided, an in-memory store is used
   */
  invocationStore?: InvocationStore;
}

/**
 * Result of validating an invocation
 */
export interface ValidateResult {
  /** Whether validation succeeded */
  ok: boolean;

  /** The invoker's DID (if valid) */
  invoker?: string;

  /** The validated capability (if valid) */
  capability?: {
    can: string;
    with: string;
    nb?: Record<string, unknown>;
  };

  /** Error details (if invalid) */
  error?: {
    code:
      | 'INVALID_FORMAT'
      | 'INVALID_SIGNATURE'
      | 'UNAUTHORIZED'
      | 'REPLAY'
      | 'EXPIRED'
      | 'CAVEAT_VIOLATION';
    message: string;
  };
}

/**
 * A framework-agnostic UCAN validator
 */
export interface UCANValidator {
  /**
   * Validate an invocation against a capability definition
   *
   * @param invocationBase64 - Base64-encoded CAR containing the invocation
   * @param capabilityDef - Capability definition from defineCapability()
   * @param resource - The specific resource URI to validate against
   * @returns Validation result
   *
   * @example
   * ```typescript
   * const result = await validator.validate(
   *   invocationBase64,
   *   EmployeesRead,
   *   'myapp:company/acme'
   * );
   * ```
   */
  validate(
    invocationBase64: string,
    capabilityDef: CapabilityParser,
    resource: string,
  ): Promise<ValidateResult>;

  /**
   * The server's public DID (as provided in options)
   */
  readonly serverDid: string;
}

/**
 * Create a UCAN validator (async to support DID resolution at startup)
 *
 * @param options - Validator configuration
 * @returns A validator instance
 *
 * @example
 * ```typescript
 * import { createUCANValidator, defineCapability, Schema, createIxoDIDResolver } from '@ixo/ucan';
 *
 * // Define capability
 * const EmployeesRead = defineCapability({
 *   can: 'employees/read',
 *   protocol: 'myapp:',
 *   nb: { limit: Schema.integer().optional() },
 *   derives: (claimed, delegated) => {
 *     const claimedLimit = claimed.nb?.limit ?? Infinity;
 *     const delegatedLimit = delegated.nb?.limit ?? Infinity;
 *     if (claimedLimit > delegatedLimit) {
 *       return { error: new Error(`Limit exceeds delegated`) };
 *     }
 *     return { ok: {} };
 *   }
 * });
 *
 * // Create validator with did:ixo server identity
 * const validator = await createUCANValidator({
 *   serverDid: 'did:ixo:ixo1abc...',  // Any DID method supported
 *   rootIssuers: ['did:ixo:ixo1admin...'],
 *   didResolver: createIxoDIDResolver({ indexerUrl: '...' }),
 * });
 *
 * // Validate invocations
 * const result = await validator.validate(invocationBase64, EmployeesRead, 'myapp:server');
 * ```
 */
export async function createUCANValidator(
  options: CreateValidatorOptions,
): Promise<UCANValidator> {
  const invocationStore =
    options.invocationStore ?? new InMemoryInvocationStore();

  // Resolve server DID to get verifier
  // This supports any DID method - did:key is parsed directly, others use the resolver
  let serverVerifier: Verifier;

  if (options.serverDid.startsWith('did:key:')) {
    // did:key can be parsed directly (contains the public key)
    serverVerifier = ed25519.Verifier.parse(options.serverDid);
  } else {
    // Non-did:key requires resolution
    if (!options.didResolver) {
      throw new Error(
        `Cannot use ${options.serverDid} as server DID without a didResolver. ` +
          `Provide a didResolver to resolve non-did:key DIDs, or use a did:key directly.`,
      );
    }

    const resolved = await options.didResolver(
      options.serverDid as `did:${string}:${string}`,
    );

    if ('error' in resolved) {
      throw new Error(
        `Failed to resolve server DID ${options.serverDid}: ${resolved.error.message}`,
      );
    }

    if (!resolved.ok || resolved.ok.length === 0) {
      throw new Error(
        `No keys found for server DID ${options.serverDid}. ` +
          `The DID document must have at least one verification method.`,
      );
    }

    // Use the first key (primary key)
    const keyDid = resolved.ok[0];
    if (!keyDid) {
      throw new Error(`No valid key found for server DID ${options.serverDid}`);
    }

    serverVerifier = ed25519.Verifier.parse(keyDid);
  }

  // Create DID resolver for use during validation (for issuers in delegation chain)
  const resolveDIDKey = async (did: `did:${string}:${string}`) => {
    // Defensive: ensure did is a string
    if (typeof did !== 'string') {
      console.error('[resolveDIDKey] ERROR: did is not a string!', did);
      return {
        error: {
          name: 'DIDKeyResolutionError' as const,
          did: String(did),
          message: `Expected DID string, got ${typeof did}`,
        },
      };
    }

    // did:key resolves to itself - return as array of DID strings (ucanto iterates over result.ok)
    if (did.startsWith('did:key:')) {
      return { ok: [did] };
    }

    // Try custom resolver for other DID methods (e.g., did:ixo)
    if (options.didResolver) {
      const result = await options.didResolver(did);
      if ('ok' in result && result.ok.length > 0) {
        // Return the array of did:key strings (ucanto will parse them)
        return { ok: result.ok };
      }
      if ('error' in result) {
        return {
          error: {
            name: 'DIDKeyResolutionError' as const,
            did,
            message: result.error.message,
          },
        };
      }
    }

    return {
      error: {
        name: 'DIDKeyResolutionError' as const,
        did,
        message: `Cannot resolve DID: ${did}`,
      },
    };
  };

  return {
    serverDid: options.serverDid,

    async validate(
      invocationBase64,
      capabilityDef,
      resource,
    ): Promise<ValidateResult> {
      try {
        // 1. Decode the invocation from base64 CAR
        const carBytes = new Uint8Array(
          Buffer.from(invocationBase64, 'base64'),
        );

        // 2. Extract the invocation from CAR
        const extracted = await Delegation.extract(carBytes);
        if (extracted.error) {
          return {
            ok: false,
            error: {
              code: 'INVALID_FORMAT',
              message: `Failed to decode: ${extracted.error?.message ?? 'unknown'}`,
            },
          };
        }

        const invocation = 'ok' in extracted ? extracted.ok : extracted;

        // 3. Basic validation - check we have required fields
        if (!invocation?.issuer?.did || !invocation?.audience?.did) {
          return {
            ok: false,
            error: {
              code: 'INVALID_FORMAT',
              message: 'Invocation missing issuer or audience',
            },
          };
        }

        // 4. Check audience matches this server's public DID
        const audienceDid = invocation.audience.did();
        if (audienceDid !== options.serverDid) {
          return {
            ok: false,
            error: {
              code: 'UNAUTHORIZED',
              message: `Invocation addressed to ${audienceDid}, not ${options.serverDid}`,
            },
          };
        }

        // 5. Check replay protection
        const invocationCid = invocation.cid?.toString();
        if (invocationCid && (await invocationStore.has(invocationCid))) {
          return {
            ok: false,
            error: {
              code: 'REPLAY',
              message: 'Invocation has already been used',
            },
          };
        }

        // 6. Use ucanto's claim() to validate
        // The serverVerifier was resolved at startup (supports any DID method)
        const claimResult = claim(capabilityDef, [invocation], {
          authority: serverVerifier,
          principal: ed25519.Verifier,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ucanto claim() expects a specific DID resolver signature incompatible with our async resolver
          resolveDIDKey: resolveDIDKey as any,
          canIssue: (cap: { with: string }, issuer: string) => {
            // Root issuers can issue any capability
            if (options.rootIssuers.includes(issuer)) return true;
            // Allow self-issued capabilities where resource contains issuer DID
            if (typeof cap.with === 'string' && cap.with.includes(issuer))
              return true;
            return false;
          },
          validateAuthorization: () => ({ ok: {} }),
        });

        const accessResult = await claimResult;

        if (accessResult.error) {
          // Check if it's a caveat/derives error
          const errorMsg = accessResult.error.message ?? 'Authorization failed';
          const isCaveatError =
            errorMsg.includes('limit') ||
            errorMsg.includes('caveat') ||
            errorMsg.includes('exceeds') ||
            errorMsg.includes('violates');

          return {
            ok: false,
            error: {
              code: isCaveatError ? 'CAVEAT_VIOLATION' : 'UNAUTHORIZED',
              message: errorMsg,
            },
          };
        }

        // 7. Verify the resource matches
        const validatedCap = invocation.capabilities?.[0];
        if (validatedCap && validatedCap.with !== resource) {
          // Check if it's a wildcard match
          const capWith = validatedCap.with as string;
          const isWildcardMatch =
            (capWith.endsWith('/*') &&
              resource.startsWith(capWith.slice(0, -1))) ||
            (capWith.endsWith(':*') &&
              resource.startsWith(capWith.slice(0, -1)));

          if (!isWildcardMatch) {
            return {
              ok: false,
              error: {
                code: 'UNAUTHORIZED',
                message: `Resource ${validatedCap.with} does not match ${resource}`,
              },
            };
          }
        }

        // 8. Success! Mark invocation as used for replay protection
        if (invocationCid) {
          await invocationStore.add(invocationCid);
        }

        return {
          ok: true,
          invoker: invocation.issuer.did(),
          capability: validatedCap
            ? {
                can: validatedCap.can,
                with: validatedCap.with as string,
                nb: validatedCap.nb as Record<string, unknown> | undefined,
              }
            : undefined,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { ok: false, error: { code: 'INVALID_FORMAT', message } };
      }
    },
  };
}
