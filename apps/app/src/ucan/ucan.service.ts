/**
 * @fileoverview UCAN service for Oracle
 *
 * This service handles UCAN validation for MCP tool invocations.
 * It uses ucanto for validation with IXO-specific DID resolution.
 *
 * NOTE: This service includes inline implementations of some @ixo/ucan
 * functionality to avoid build-time dependencies. Once @ixo/ucan is
 * properly built and published, these can be replaced with imports.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ENV } from 'src/config';
import {
  type MCPUCANConfig,
  createMCPUCANConfig,
  requiresUCANAuth,
  buildRequiredCapability,
  loadUCANConfigFromEnv,
} from './ucan.config';

// ============================================================================
// Inline implementations (can be replaced with @ixo/ucan imports once built)
// ============================================================================

type KeyDID = `did:key:${string}`;

/**
 * DID key resolver function type
 */
type DIDKeyResolver = (
  did: string,
) => Promise<
  { ok: KeyDID[] } | { error: { name: string; did: string; message: string } }
>;

/**
 * Invocation store for replay protection
 */
interface InvocationStore {
  has(cid: string): Promise<boolean>;
  add(cid: string, ttlMs?: number): Promise<void>;
  cleanup?(): Promise<void>;
}

/**
 * In-memory implementation of InvocationStore
 */
class InMemoryInvocationStore implements InvocationStore {
  private store = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly defaultTtlMs: number;

  constructor(
    options: { defaultTtlMs?: number; cleanupIntervalMs?: number } = {},
  ) {
    this.defaultTtlMs = options.defaultTtlMs ?? 24 * 60 * 60 * 1000;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1000;

    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  async has(cid: string): Promise<boolean> {
    const expiry = this.store.get(cid);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.store.delete(cid);
      return false;
    }
    return true;
  }

  async add(cid: string, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(cid, Date.now() + ttl);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [cid, expiry] of this.store.entries()) {
      if (now > expiry) {
        this.store.delete(cid);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Create an IXO DID resolver that queries the blockchain indexer
 */
function createIxoDIDResolver(config: { indexerUrl: string }): DIDKeyResolver {
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

  return async (did: string) => {
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
      const response = await fetch(config.indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      interface VerificationMethod {
        id: string;
        type: string;
        publicKeyMultibase?: string;
      }

      const data = (await response.json()) as {
        data?: {
          iids?: {
            nodes?: Array<{ verificationMethod?: VerificationMethod[] }>;
          };
        };
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

      const keys: KeyDID[] = [];
      for (const vm of didDoc.verificationMethod || []) {
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
            message: `No valid Ed25519 verification methods found for ${did}`,
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
 * Create a composite DID resolver
 */
function createCompositeDIDResolver(
  resolvers: DIDKeyResolver[],
): DIDKeyResolver {
  return async (did: string) => {
    for (const resolver of resolvers) {
      const result = await resolver(did);
      if ('ok' in result) {
        return result;
      }
      if (result.error.message.includes('not a did:')) {
        continue;
      }
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

/**
 * Create MCP resource URI
 */
function createMCPResourceURI(
  oracleDid: string,
  serverName: string,
  toolName: string,
): string {
  return `ixo:oracle:${oracleDid}:mcp/${serverName}/${toolName}`;
}

// ============================================================================
// UCAN Service
// ============================================================================

/**
 * Result of validating an MCP tool invocation
 */
export interface MCPValidationResult {
  /** Whether the invocation is valid */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** The invoker's DID if validation succeeded */
  invokerDid?: string;
}

@Injectable()
export class UcanService implements OnModuleDestroy {
  private readonly logger = new Logger(UcanService.name);
  private readonly config: MCPUCANConfig;
  private readonly invocationStore: InvocationStore;
  private readonly didResolver: DIDKeyResolver;

  constructor(private readonly configService: ConfigService<ENV>) {
    // Load configuration
    this.config = this.loadConfig();

    // Create invocation store for replay protection
    this.invocationStore = new InMemoryInvocationStore({
      defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
      cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
    });

    // Create DID resolver
    const indexerUrl = this.configService.get(
      'BLOCKSYNC_GRAPHQL_URL' as keyof ENV,
    );
    this.didResolver = this.createDIDResolver(indexerUrl as string | undefined);

    this.logger.log('UCAN service initialized');
    this.logger.log(`Oracle DID: ${this.config.oracleDid}`);
    this.logger.log(`Root issuers: ${this.config.rootIssuers.join(', ')}`);
    this.logger.log(
      `Protected MCP servers: ${Object.keys(this.config.requirements).join(', ') || 'none'}`,
    );
  }

  onModuleDestroy() {
    if (this.invocationStore instanceof InMemoryInvocationStore) {
      this.invocationStore.destroy();
    }
  }

  private loadConfig(): MCPUCANConfig {
    const envConfig = loadUCANConfigFromEnv();
    const oracleDid =
      this.configService.get('ORACLE_ENTITY_DID') || envConfig.oracleDid;
    const rootIssuers =
      envConfig.rootIssuers.length > 0 ? envConfig.rootIssuers : [oracleDid];

    return createMCPUCANConfig(oracleDid, rootIssuers, {});
  }

  private createDIDResolver(indexerUrl?: string): DIDKeyResolver {
    const resolvers: DIDKeyResolver[] = [];

    if (indexerUrl) {
      resolvers.push(createIxoDIDResolver({ indexerUrl }));
    }

    // did:key passthrough resolver
    const didKeyResolver: DIDKeyResolver = async (did) => {
      if (did.startsWith('did:key:')) {
        return { ok: [did as KeyDID] };
      }
      return {
        error: {
          name: 'DIDKeyResolutionError',
          did,
          message: 'Not a did:key',
        },
      };
    };
    resolvers.push(didKeyResolver);

    return createCompositeDIDResolver(resolvers);
  }

  /**
   * Check if an MCP tool requires UCAN authorization
   */
  requiresAuth(serverName: string, toolName?: string): boolean {
    return requiresUCANAuth(this.config, serverName, toolName);
  }

  /**
   * Validate an MCP tool invocation
   *
   * TODO: Implement full ucanto-based validation once @ixo/ucan package is built.
   * For now, this is a placeholder that logs the validation attempt.
   */
  async validateMCPInvocation(
    serverName: string,
    toolName: string,
    invocationData: Uint8Array | string,
  ): Promise<MCPValidationResult> {
    try {
      // Convert string to Uint8Array if needed
      const invocationBytes =
        typeof invocationData === 'string'
          ? Buffer.from(invocationData, 'base64')
          : invocationData;

      // TODO: Implement full ucanto validation once package is built
      // For now, we do basic validation
      if (invocationBytes.length === 0) {
        return {
          valid: false,
          error: 'Empty invocation data',
        };
      }

      // Generate a simple CID-like hash for replay protection
      const crypto = await import('node:crypto');
      const hash = crypto
        .createHash('sha256')
        .update(invocationBytes)
        .digest('hex');
      const pseudoCid = `bafy${hash.slice(0, 52)}`;

      // Check for replay
      if (await this.invocationStore.has(pseudoCid)) {
        return {
          valid: false,
          error: 'Invocation has already been used (replay attack prevented)',
        };
      }

      // Build required capability
      const requiredCapability = buildRequiredCapability(
        this.config,
        serverName,
        toolName,
      );

      this.logger.log(
        `UCAN validation for ${serverName}/${toolName} - Required capability: ${requiredCapability.can} on ${requiredCapability.with}`,
      );

      // TODO: Full validation with ucanto
      // For MVP, we mark as used and return valid
      // This allows the system to work while full validation is being implemented
      this.logger.warn(
        `UCAN validation is in placeholder mode. Full ucanto validation will be enabled once @ixo/ucan is built.`,
      );

      await this.invocationStore.add(pseudoCid);

      return {
        valid: true,
        invokerDid: 'placeholder:invoker',
      };
    } catch (error) {
      this.logger.error(
        `UCAN validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get the required capability URI for an MCP tool
   */
  getRequiredCapabilityURI(serverName: string, toolName: string): string {
    return createMCPResourceURI(this.config.oracleDid, serverName, toolName);
  }

  /**
   * Get the oracle's DID
   */
  getOracleDid(): string {
    return this.config.oracleDid;
  }

  /**
   * Get the list of root issuers
   */
  getRootIssuers(): string[] {
    return this.config.rootIssuers;
  }
}

// TODO: Replace inline implementations with @ixo/ucan imports once package is built
// TODO: Add full ucanto-based validation
// TODO: Add caching for validated invocations
// TODO: Add metrics for validation success/failure rates
