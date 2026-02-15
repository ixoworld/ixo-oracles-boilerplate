/**
 * @fileoverview In-memory invocation store for replay protection
 *
 * This module provides a simple in-memory implementation of the InvocationStore
 * interface for tracking used invocation CIDs to prevent replay attacks.
 *
 * For production use with multiple instances, consider using a distributed
 * store like Redis.
 */

import type { InvocationStore } from '../types.js';

/**
 * Entry in the invocation store
 */
interface StoreEntry {
  /** Timestamp when this entry expires */
  expiresAt: number;
}

/**
 * In-memory implementation of InvocationStore for replay protection
 *
 * Features:
 * - Automatic TTL-based expiration
 * - Periodic cleanup of expired entries
 * - Thread-safe (single-threaded JS)
 *
 * Limitations:
 * - Data is lost on process restart
 * - Not suitable for distributed deployments
 *
 * @example
 * ```typescript
 * const store = new InMemoryInvocationStore();
 *
 * // Check if invocation was already used
 * if (await store.has(invocationCid)) {
 *   throw new Error('Replay attack detected');
 * }
 *
 * // Mark invocation as used
 * await store.add(invocationCid);
 * ```
 */
export class InMemoryInvocationStore implements InvocationStore {
  private store = new Map<string, StoreEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Default TTL: 24 hours */
  private readonly defaultTtlMs: number;

  /** Cleanup interval: 1 hour */
  private readonly cleanupIntervalMs: number;

  /**
   * Create a new in-memory invocation store
   *
   * @param options - Configuration options
   * @param options.defaultTtlMs - Default TTL for entries (default: 24 hours)
   * @param options.cleanupIntervalMs - Interval for cleanup (default: 1 hour)
   * @param options.enableAutoCleanup - Whether to enable automatic cleanup (default: true)
   */
  constructor(
    options: {
      defaultTtlMs?: number;
      cleanupIntervalMs?: number;
      enableAutoCleanup?: boolean;
    } = {},
  ) {
    this.defaultTtlMs = options.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1000; // 1 hour

    if (options.enableAutoCleanup !== false) {
      this.startAutoCleanup();
    }
  }

  /**
   * Check if an invocation CID has already been used
   *
   * @param cid - The CID of the invocation
   * @returns True if the CID has been used and is not expired
   */
  async has(cid: string): Promise<boolean> {
    const entry = this.store.get(cid);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(cid);
      return false;
    }

    return true;
  }

  /**
   * Mark an invocation CID as used
   *
   * @param cid - The CID of the invocation
   * @param ttlMs - Time-to-live in milliseconds (default: 24 hours)
   */
  async add(cid: string, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(cid, {
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Remove all expired entries from the store
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;

    for (const [cid, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(cid);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(
        `[InMemoryInvocationStore] Cleaned up ${cleaned} expired entries`,
      );
    }
  }

  /**
   * Get the current size of the store
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clear all entries from the store
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Start automatic cleanup interval
   */
  private startAutoCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, this.cleanupIntervalMs);

    // Don't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop automatic cleanup and release resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Create an invocation store instance
 * Factory function for easier testing and dependency injection
 *
 * @param options - Store configuration
 * @returns An InvocationStore implementation
 */
export function createInvocationStore(options?: {
  defaultTtlMs?: number;
  cleanupIntervalMs?: number;
  enableAutoCleanup?: boolean;
}): InvocationStore {
  return new InMemoryInvocationStore(options);
}

// TODO: Add Redis implementation for distributed deployments
// TODO: Add SQLite implementation for persistence across restarts
// TODO: Add metrics/monitoring for store size and cleanup operations
