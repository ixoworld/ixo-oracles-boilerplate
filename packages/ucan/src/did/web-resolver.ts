/**
 * @fileoverview did:web resolver for UCAN validation
 *
 * Resolves did:web identifiers by fetching the DID document from
 * the well-known endpoint as defined in the did:web specification.
 *
 * @see https://w3c-ccg.github.io/did-method-web/
 */

import type { DID } from '@ucanto/interface';
import type { DIDKeyResolver, KeyDID } from '../types.js';

export interface WebDIDResolverConfig {
  fetch?: typeof globalThis.fetch;
  /** If true, retry with http:// when https:// fetch fails. Default: false. */
  fallbackToHttp?: boolean;
}

interface VerificationMethod {
  id: string;
  type: string;
  publicKeyMultibase?: string;
}

/**
 * Creates a DID resolver for did:web identifiers
 *
 * Fetches the DID document from `https://{domain}/.well-known/did.json`
 * (or `https://{domain}/{path}/did.json` for path-based did:web DIDs)
 * and extracts Ed25519 verification methods as did:key identifiers.
 *
 * @example
 * ```typescript
 * const resolver = createWebDIDResolver();
 * const result = await resolver('did:web:sandbox.ixo.world');
 * if ('ok' in result) {
 *   console.log('Keys:', result.ok); // ['did:key:z6Mk...']
 * }
 * ```
 */
export function createWebDIDResolver(
  config?: WebDIDResolverConfig,
): DIDKeyResolver {
  const fetchFn = config?.fetch ?? globalThis.fetch;

  return async (
    did: DID,
  ): Promise<
    { ok: KeyDID[] } | { error: { name: string; did: string; message: string } }
  > => {
    if (!did.startsWith('did:web:')) {
      return {
        error: {
          name: 'DIDKeyResolutionError',
          did,
          message: `Cannot resolve ${did}: not a did:web identifier`,
        },
      };
    }

    try {
      // did:web:example.com → https://example.com/.well-known/did.json
      // did:web:example.com:path:to → https://example.com/path/to/did.json
      const parts = did.slice('did:web:'.length).split(':');
      const domain = decodeURIComponent(parts[0]!);
      const pathSegments = parts.slice(1).map(decodeURIComponent);

      const path =
        pathSegments.length > 0
          ? `/${pathSegments.join('/')}/did.json`
          : '/.well-known/did.json';

      // Use HTTP directly for localhost (no TLS available, avoids ~15s connection timeout)
      const isLocalhost = domain.startsWith('localhost');
      const httpsUrl = `https://${domain}${path}`;
      const httpUrl = `http://${domain}${path}`;

      let response: Response | null = null;
      let fetchUrl = isLocalhost ? httpUrl : httpsUrl;

      try {
        response = await fetchFn(fetchUrl);
      } catch (fetchError) {
        if (!isLocalhost && config?.fallbackToHttp) {
          fetchUrl = httpUrl;
          response = await fetchFn(fetchUrl);
        } else {
          throw fetchError;
        }
      }

      if (
        !response.ok &&
        !isLocalhost &&
        config?.fallbackToHttp &&
        fetchUrl === httpsUrl
      ) {
        // HTTPS returned a non-ok status, try HTTP
        fetchUrl = httpUrl;
        response = await fetchFn(fetchUrl);
      }

      if (!response.ok) {
        return {
          error: {
            name: 'DIDKeyResolutionError',
            did,
            message: `Failed to fetch DID document from ${fetchUrl}: HTTP ${response.status}`,
          },
        };
      }

      const doc = (await response.json()) as {
        verificationMethod?: VerificationMethod[];
      };

      const keys: KeyDID[] = [];
      for (const vm of doc.verificationMethod ?? []) {
        if (
          vm.type.includes('Ed25519') &&
          vm.publicKeyMultibase?.startsWith('z')
        ) {
          keys.push(`did:key:${vm.publicKeyMultibase}`);
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
