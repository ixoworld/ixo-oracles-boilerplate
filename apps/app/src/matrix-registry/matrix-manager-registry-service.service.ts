import { MatrixManager } from '@ixo/matrix';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { seconds } from '@nestjs/throttler';
import { Cache } from 'cache-manager';
import * as crypto from 'node:crypto';

type InFlightEntry = {
  promise: Promise<MatrixManager>;
};

@Injectable()
export class MatrixManagerRegistryService {
  private inFlight = new Map<string, InFlightEntry>();

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  private hashToken(accessToken: string): string {
    return crypto.createHash('sha256').update(accessToken).digest('hex');
  }

  /**
   * Get or create a live MatrixManager for the given token.
   * Prevents duplicate creations and caches the result.
   */
  async getManager(
    accessToken: string,
    idleTimeoutMs = 5 * 60_000,
  ): Promise<MatrixManager> {
    // 1. Return cached live manager if available
    const managerHashKey = this.hashToken(accessToken);
    const cached = await this.cacheManager.get<MatrixManager>(managerHashKey);
    if (cached && !cached.isDestroyed()) {
      Logger.debug(`Cache HIT for manager with hash key: ${managerHashKey}`);
      return cached;
    }

    // 2. If a creation is already in progress, wait for it
    const ongoing = this.inFlight.get(managerHashKey);
    if (ongoing) {
      Logger.debug(
        `Waiting for ongoing manager creation with hash key: ${managerHashKey}`,
      );
      return ongoing.promise;
    }

    Logger.debug(`Cache MISS for manager with hash key: ${managerHashKey}`);
    // 3. Otherwise, start creating and caching a new manager
    const creation = this.createAndCacheManager(
      accessToken,
      managerHashKey,
      idleTimeoutMs,
    );
    this.inFlight.set(managerHashKey, { promise: creation });

    try {
      return await creation;
    } finally {
      this.inFlight.delete(managerHashKey);
    }
  }

  /**
   * Helper: instantiate the manager, wrap teardown, and cache it
   */
  private async createAndCacheManager(
    accessToken: string,
    managerHashKey: string,
    idleTimeoutMs: number,
  ): Promise<MatrixManager> {
    const manager = await MatrixManager.createInstance(
      accessToken,
      idleTimeoutMs,
    );
    // When killed, also evict from cache
    const originalKill = manager.killClient.bind(manager) as () => void;
    manager.killClient = () => {
      originalKill();
      this.cacheManager.del(managerHashKey).catch((err) => {
        Logger.error('Error deleting manager from cache', err);
      });
    };

    // Cache with TTL matching idle timeout
    await this.cacheManager.set(
      managerHashKey,
      manager,
      seconds(60) * 5, // 5 minutes
    );

    return manager;
  }
}
