/**
 * @fileoverview Local DID resolver for UCAN validation
 *
 * Resolves DIDs from an in-memory registry of pre-known keys.
 * Useful for services that generate their own did:web identity and
 * need to validate UCANs addressed to themselves or sibling services
 * without making network calls.
 *
 * @example
 * ```typescript
 * import { createLocalDIDResolver, createCompositeDIDResolver, createWebDIDResolver } from '@ixo/ucan';
 *
 * const localResolver = createLocalDIDResolver();
 * // Register own DID key at startup
 * localResolver.register('did:web:myservice.example.com', 'z6MkPublicKeyMultibase...');
 *
 * const didResolver = createCompositeDIDResolver([
 *   localResolver,              // check local first (instant)
 *   createWebDIDResolver(),     // fall back to HTTP
 * ]);
 * ```
 */

import type { DID } from '@ucanto/interface';
import type { DIDKeyResolver, KeyDID } from '../types.js';

/**
 * A DID resolver with a mutable registry of locally-known DIDs.
 * Conforms to `DIDKeyResolver` so it can be used in `createCompositeDIDResolver`.
 */
export interface LocalDIDResolver extends DIDKeyResolver {
  /**
   * Register a DID with its public key multibase.
   * Subsequent calls to the resolver for this DID will return the key
   * instantly without any network call.
   *
   * @param did - The full DID string (e.g. 'did:web:localhost%3A9000')
   * @param publicKeyMultibase - The z-base58btc multibase-encoded Ed25519 public key
   */
  register(did: string, publicKeyMultibase: string): void;
}

/**
 * Creates a local DID resolver backed by an in-memory map.
 *
 * When used at the front of a composite resolver chain, it provides
 * instant resolution for known DIDs and falls through to network
 * resolvers for unknown ones.
 */
export function createLocalDIDResolver(): LocalDIDResolver {
  const registry = new Map<string, KeyDID[]>();

  const resolver = (async (
    did: DID,
  ): Promise<
    { ok: KeyDID[] } | { error: { name: string; did: string; message: string } }
  > => {
    const keys = registry.get(did);
    if (keys) {
      return { ok: keys };
    }

    // Return "not a" error so createCompositeDIDResolver skips to next resolver
    return {
      error: {
        name: 'DIDKeyResolutionError',
        did,
        message: `Cannot resolve ${did}: not a did: registered locally`,
      },
    };
  }) as LocalDIDResolver;

  resolver.register = (did: string, publicKeyMultibase: string): void => {
    const keyDid: KeyDID = `did:key:${publicKeyMultibase}`;
    registry.set(did, [keyDid]);
  };

  return resolver;
}
