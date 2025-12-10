/**
 * @fileoverview Core type definitions for @ixo/ucan
 *
 * This module provides type definitions that extend ucanto's types
 * for general use in any service that needs UCAN authorization.
 */

import type { DID, Capability as UcantoCapability } from '@ucanto/interface';

// =============================================================================
// DID Types
// =============================================================================

/**
 * IXO DID type (for IXO blockchain identities)
 */
export type IxoDID = `did:ixo:${string}`;

/**
 * Key DID type (self-describing public key DIDs)
 */
export type KeyDID = `did:key:${string}`;

/**
 * DIDs supported by this package
 */
export type SupportedDID = IxoDID | KeyDID;

// =============================================================================
// DID Resolution
// =============================================================================

/**
 * Result of DID key resolution
 */
export interface DIDKeyResolutionResult {
  /** Array of did:key identifiers that can verify signatures for this DID */
  keys: KeyDID[];
}

/**
 * DID key resolver function type
 * Takes a DID and returns the associated did:key identifiers
 */
export type DIDKeyResolver = (
  did: DID,
) => Promise<
  { ok: KeyDID[] } | { error: { name: string; did: string; message: string } }
>;

// =============================================================================
// Invocation Store (Replay Protection)
// =============================================================================

/**
 * Invocation store for replay protection
 *
 * Implementations can use in-memory, Redis, database, etc.
 */
export interface InvocationStore {
  /**
   * Check if an invocation CID has already been used
   * @param cid - The CID of the invocation
   */
  has(cid: string): Promise<boolean>;

  /**
   * Mark an invocation CID as used
   * @param cid - The CID of the invocation
   * @param ttlMs - Time-to-live in milliseconds (for cleanup)
   */
  add(cid: string, ttlMs?: number): Promise<void>;

  /**
   * Remove expired entries (optional cleanup method)
   */
  cleanup?(): Promise<void>;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Result of UCAN validation
 */
export interface ValidationResult {
  /** Whether the validation succeeded */
  valid: boolean;

  /** Error message if validation failed */
  error?: string;

  /** The DID of the invoker (if valid) */
  invokerDid?: string;

  /** The validated capability (if valid) */
  capability?: UcantoCapability;
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Serialized invocation that can be sent in HTTP requests
 */
export type SerializedInvocation = string;
