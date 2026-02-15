/**
 * @fileoverview did:ixo resolver for UCAN validation
 *
 * This module provides a DID resolver that can resolve did:ixo identifiers
 * to their associated did:key identifiers by querying the IXO blockchain
 * indexer for the DID document.
 */

import type { DID } from '@ucanto/interface';
import type { DIDKeyResolver, KeyDID } from '../types.js';
import { base58Encode, hexDecode, base58Decode } from './utils.js';

/**
 * Configuration for the IXO DID resolver
 */
export interface IxoDIDResolverConfig {
  /**
   * URL of the IXO GraphQL indexer
   * @example 'https://blocksync.ixo.earth/graphql'
   */
  indexerUrl: string;

  /**
   * Optional fetch implementation (for testing or custom environments)
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * GraphQL query to fetch DID document from IXO indexer
 */
const DID_DOCUMENT_QUERY = `
  query GetDIDDocument($id: String!) {
    iids(filter: { id: { equalTo: $id } }) {
      nodes {
        id
        verificationMethod
      }
    }
  }
`;

/**
 * Verification method from IXO DID document
 */
interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  publicKeyHex?: string;
  publicKeyBase58?: string;
}

/**
 * IXO DID document structure (partial)
 */
interface IxoDIDDocument {
  id: string;
  verificationMethod: VerificationMethod[];
}



// =============================================================================
// did:key Conversion
// =============================================================================

/**
 * Ed25519 multicodec prefix (0xed)
 * When creating a did:key, we prepend this to the raw public key
 */
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Convert raw Ed25519 public key bytes to did:key format
 *
 * did:key format for Ed25519:
 * - Prefix with multicodec 0xed01
 * - Encode with base58btc (multibase 'z' prefix)
 * - Result: did:key:z6Mk...
 */
function rawPublicKeyToDidKey(publicKeyBytes: Uint8Array): KeyDID | null {
  // Ed25519 public keys should be 32 bytes
  if (publicKeyBytes.length !== 32) {
    console.warn(
      `[IxoDIDResolver] Expected 32-byte Ed25519 key, got ${publicKeyBytes.length} bytes`,
    );
    return null;
  }

  // Prepend the Ed25519 multicodec prefix
  const prefixedKey = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKeyBytes.length,
  );
  prefixedKey.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixedKey.set(publicKeyBytes, ED25519_MULTICODEC_PREFIX.length);

  // Encode with base58btc and add 'z' multibase prefix
  const multibaseEncoded = 'z' + base58Encode(prefixedKey);

  return `did:key:${multibaseEncoded}`;
}

/**
 * Convert a public key to did:key format
 * Supports Ed25519 keys in multibase, hex, or base58 format
 */
function publicKeyToDidKey(vm: VerificationMethod): KeyDID | null {
  // console.log('vm', vm);
  // Handle multibase format (preferred)
  if (vm.publicKeyMultibase) {
    // Multibase Ed25519 public keys start with 'z' (base58btc)
    // The did:key format for Ed25519 is did:key:z6Mk...
    if (vm.publicKeyMultibase.startsWith('z')) {
      // Already in the correct format for did:key
      return `did:key:${vm.publicKeyMultibase}`;
    }

    // Handle other multibase prefixes if needed
    console.warn(
      `[IxoDIDResolver] Unsupported multibase prefix for ${vm.id}: ${vm.publicKeyMultibase.charAt(0)}`,
    );
    return null;
  }

  // Handle hex format
  if (vm.publicKeyHex) {
    try {
      const publicKeyBytes = hexDecode(vm.publicKeyHex);
      const didKey = rawPublicKeyToDidKey(publicKeyBytes);
      return didKey;
    } catch (error) {
      console.warn(
        `[IxoDIDResolver] Failed to decode publicKeyHex for ${vm.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  // Handle base58 format
  if (vm.publicKeyBase58) {
    try {
      const publicKeyBytes = base58Decode(vm.publicKeyBase58);
      const didKey = rawPublicKeyToDidKey(publicKeyBytes);
      return didKey;
    } catch (error) {
      console.warn(
        `[IxoDIDResolver] Failed to decode publicKeyBase58 for ${vm.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  return null;
}

/**
 * Creates a DID resolver for did:ixo identifiers
 *
 * This resolver queries the IXO blockchain indexer to fetch DID documents
 * and extracts the verification methods that can be used to verify signatures.
 *
 * @param config - Configuration for the resolver
 * @returns A DIDKeyResolver function compatible with ucanto
 *
 * @example
 * ```typescript
 * const resolver = createIxoDIDResolver({
 *   indexerUrl: 'https://blocksync.ixo.earth/graphql'
 * });
 *
 * const result = await resolver('did:ixo:abc123');
 * if (result.ok) {
 *   console.log('Keys:', result.ok); // ['did:key:z6Mk...']
 * }
 * ```
 */
export function createIxoDIDResolver(
  config: IxoDIDResolverConfig,
): DIDKeyResolver {
  const fetchFn = config.fetch ?? globalThis.fetch;

  return async (
    did: DID,
  ): Promise<
    { ok: KeyDID[] } | { error: { name: string; did: string; message: string } }
    > => {
    // Only handle did:ixo
    if (!did.startsWith('did:ixo:')) {
      return {
        error: {
          name: 'DIDKeyResolutionError',
          did,
          message: `Cannot resolve ${did}: not a did:ixo identifier`,
        },
      };
    }

    try {
      // Query the IXO indexer
      const response = await fetchFn(config.indexerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: DID_DOCUMENT_QUERY,
          variables: { id: did },
        }),
      });

      if (!response.ok) {
        return {
          error: {
            name: 'DIDKeyResolutionError',
            did,
            message: `Failed to fetch DID document: HTTP ${response.status}`,
          },
        };
      }

      const data = (await response.json()) as {
        data?: { iids?: { nodes?: IxoDIDDocument[] } };
        errors?: Array<{ message: string }>;
      };

      if (data.errors && data.errors.length > 0) {
        return {
          error: {
            name: 'DIDKeyResolutionError',
            did,
            message: `GraphQL error: ${data.errors[0]?.message ?? 'Unknown error'}`,
          },
        };
      }

      const didDoc = data.data?.iids?.nodes?.[0];
      if (!didDoc) {
        return {
          error: {
            name: 'DIDKeyResolutionError',
            did,
            message: `DID document not found for ${did}`,
          },
        };
      }

      // Extract verification methods and convert to did:key
      const keys: KeyDID[] = [];

      for (const vm of didDoc.verificationMethod || []) {
        // Look for Ed25519 verification methods
        // Common types: Ed25519VerificationKey2018, Ed25519VerificationKey2020, JsonWebKey2020
        if (
          vm.type.includes('Ed25519') ||
          vm.type === 'JsonWebKey2020' ||
          vm.id.includes('signing')
        ) {
          const keyDid = publicKeyToDidKey(vm);
          if (keyDid) {
            keys.push(keyDid);
          }
        }
      }

      if (keys.length === 0) {
        return {
          error: {
            name: 'DIDKeyResolutionError',
            did,
            message: `No valid Ed25519 verification methods found in DID document for ${did}`,
          },
        };
      }

      return { ok: keys };
    } catch (error) {
      return {
        error: {
          name: 'DIDKeyResolutionError',
          did,
          message: `Failed to resolve ${did}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      };
    }
  };
}

/**
 * Creates a composite DID resolver that tries multiple resolvers in order
 *
 * @param resolvers - Array of DID resolvers to try
 * @returns A DIDKeyResolver that tries each resolver until one succeeds
 */
export function createCompositeDIDResolver(
  resolvers: DIDKeyResolver[],
): DIDKeyResolver {
  return async (did: DID) => {
    for (const resolver of resolvers) {
      const result = await resolver(did);
      if ('ok' in result) {
        return result;
      }
      // If this resolver doesn't handle this DID method, try the next one
      if (result.error.message.includes('not a did:')) {
        continue;
      }
      // If it's a different error, return it
      return result;
    }

    return {
      error: {
        name: 'DIDKeyResolutionError',
        did,
        message: `No resolver could handle ${did}`,
      },
    };
  };
}

// TODO: Add caching layer for resolved DIDs
// TODO: Add support for resolving from local DID document store

