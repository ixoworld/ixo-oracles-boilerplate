import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MatrixClient, SyncStateData } from 'matrix-js-sdk';
import { ClientEvent, createClient, SyncState } from 'matrix-js-sdk';
import { type ENV } from 'src/config';
import { BLOCKNOTE_TOOLS_CONFIG } from './blocknote-tools';

/**
 * EditorMatrixClient - Thread-Safe Singleton for Editor Matrix Operations
 *
 * Manages a single Matrix client instance for the editor functionality.
 * Ensures proper initialization and background sync.
 *
 * Usage:
 *   const client = EditorMatrixClient.getInstance();
 *   await client.init();
 *   const matrixClient = client.getClient();
 */
export class EditorMatrixClient {
  private static instance: EditorMatrixClient | null = null;

  private matrixClient: MatrixClient | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private persistentSyncListener:
    | ((
        state: SyncState,
        prevState: SyncState | null,
        data?: SyncStateData,
      ) => void)
    | null = null;

  private readonly logger = new Logger('EditorMatrixClient');
  private readonly configService = new ConfigService<ENV>();

  // Configuration
  private readonly SYNC_POLL_TIMEOUT = 30000; // 30 seconds - standard for Matrix
  private readonly INITIAL_SYNC_LIMIT = 20;
  private readonly INITIAL_SYNC_TIMEOUT = 60000; // 60 seconds max wait for initial sync

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  /**
   * Get the singleton instance
   * This is thread-safe and will always return the same instance
   */
  public static getInstance(): EditorMatrixClient {
    if (!EditorMatrixClient.instance) {
      EditorMatrixClient.instance = new EditorMatrixClient();
    }
    return EditorMatrixClient.instance;
  }

  /**
   * Initialize the Matrix client and start background sync
   * Safe to call multiple times - will only initialize once
   * Concurrent calls will wait for the same initialization to complete
   */
  public async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized && this.matrixClient) {
      this.logger.log('EditorMatrixClient already initialized');
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      this.logger.log('Waiting for ongoing initialization to complete...');
      return this.initializationPromise;
    }

    // Start new initialization
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async performInitialization(): Promise<void> {
    try {
      this.logger.log('🚀 Starting EditorMatrixClient initialization...');

      const baseUrl = BLOCKNOTE_TOOLS_CONFIG.matrix.baseUrl;
      const userId = BLOCKNOTE_TOOLS_CONFIG.matrix.userId;
      const accessToken = BLOCKNOTE_TOOLS_CONFIG.matrix.accessToken;

      if (!baseUrl || !userId || !accessToken) {
        throw new Error(
          'Missing Matrix configuration. Check BLOCKNOTE_TOOLS_CONFIG.',
        );
      }

      this.logger.debug(
        `Matrix client config - Base URL: ${baseUrl}, User ID: ${userId}`,
      );

      // Create Matrix client
      this.matrixClient = createClient({
        baseUrl,
        accessToken,
        userId,
        timelineSupport: true,
        fetchFn: fetch,
      });

      this.logger.log('✓ Matrix client instance created');

      // Start client and wait for initial sync
      await this.startAndSync();

      // Mark as initialized
      this.isInitialized = true;
      this.logger.log('✅ EditorMatrixClient initialization completed');
    } catch (error) {
      this.logger.error('❌ EditorMatrixClient initialization failed:', error);

      // Cleanup on failure
      await this.cleanup();

      throw error;
    }
  }

  private async startAndSync(): Promise<void> {
    if (!this.matrixClient) {
      throw new Error('Matrix client not created');
    }

    this.logger.log(
      `Starting Matrix client with ${this.SYNC_POLL_TIMEOUT}ms poll timeout`,
    );

    // Set up persistent background sync monitoring
    this.setupPersistentSyncListener();

    // Wait for initial sync to complete
    await this.waitForInitialSync();

    this.logger.log('✓ Matrix client started and initial sync completed');
  }

  /**
   * Set up a persistent listener that monitors sync throughout the client's lifetime
   */
  private setupPersistentSyncListener(): void {
    if (!this.matrixClient) {
      return;
    }

    this.persistentSyncListener = (
      state: SyncState,
      prevState: SyncState | null,
      data?: SyncStateData,
    ) => {
      // Log state transitions (debug level for routine syncs)
      if (state !== SyncState.Syncing) {
        this.logger.debug(
          `Matrix sync: ${prevState || 'null'} → ${state}`,
          data ? { data } : {},
        );
      }

      // Handle errors that occur during background sync
      if (state === SyncState.Error) {
        this.logger.error(
          `⚠️  Matrix background sync error: ${JSON.stringify(data)}`,
        );
        // Client will automatically retry, so we just log the error
        // If you want to implement custom retry logic, do it here
      }

      // Log when sync is caught up
      if (state === SyncState.Syncing && prevState === SyncState.Prepared) {
        this.logger.debug('Matrix client catching up on sync...');
      }

      if (state === SyncState.Syncing) {
      }
    };

    this.matrixClient.on(ClientEvent.Sync, this.persistentSyncListener);
    this.logger.debug('✓ Persistent sync listener registered');
  }

  /**
   * Wait for the initial sync to complete
   * Uses a one-time listener that resolves when sync is ready
   */
  private async waitForInitialSync(): Promise<void> {
    if (!this.matrixClient) {
      throw new Error('Matrix client not created');
    }

    const client = this.matrixClient; // Store reference for closure

    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      let timeoutId: NodeJS.Timeout;

      const initialSyncListener = (
        state: SyncState,
        _prevState: SyncState | null,
        data?: SyncStateData,
      ) => {
        if (resolved) return;

        this.logger.debug(`Initial sync state: ${state}`);

        // Handle errors during initial sync
        if (state === SyncState.Error) {
          resolved = true;
          clearTimeout(timeoutId);
          client.removeListener(ClientEvent.Sync, initialSyncListener);
          reject(new Error(`Initial sync failed: ${JSON.stringify(data)}`));
          return;
        }

        // Wait for either PREPARED or SYNCING state
        // PREPARED means initial sync is done
        // SYNCING means sync is in progress and client is usable
        if (state === SyncState.Prepared || state === SyncState.Syncing) {
          resolved = true;
          clearTimeout(timeoutId);
          client.removeListener(ClientEvent.Sync, initialSyncListener);
          this.logger.log(`✓ Initial sync ready (state: ${state})`);
          resolve();
        }
      };

      // Set up timeout for initial sync
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.removeListener(ClientEvent.Sync, initialSyncListener);
          reject(
            new Error(
              `Initial sync timeout after ${this.INITIAL_SYNC_TIMEOUT}ms`,
            ),
          );
        }
      }, this.INITIAL_SYNC_TIMEOUT);

      // Register one-time initial sync listener
      client.on(ClientEvent.Sync, initialSyncListener);

      // Start the client
      this.logger.log('Starting Matrix client...');
      client.startClient({
        initialSyncLimit: this.INITIAL_SYNC_LIMIT,
        pollTimeout: this.SYNC_POLL_TIMEOUT,
      });
    });
  }

  /**
   * Get the Matrix client instance
   * Throws if not initialized - always call init() first
   */
  public getClient(): MatrixClient {
    if (!this.isInitialized || !this.matrixClient) {
      throw new Error(
        'EditorMatrixClient not initialized. Call await init() first.',
      );
    }
    return this.matrixClient;
  }

  /**
   * Check initialization status
   */
  public getInitializationStatus(): {
    isInitialized: boolean;
    isInitializing: boolean;
  } {
    return {
      isInitialized: this.isInitialized,
      isInitializing: this.initializationPromise !== null,
    };
  }

  /**
   * Check if the client is ready to use
   * Returns true if initialized, false if still initializing
   */
  public isReady(): boolean {
    return this.isInitialized && this.matrixClient !== null;
  }

  /**
   * Wait for the client to be ready
   * Useful when you need to ensure the client is initialized before using it
   */
  public async waitUntilReady(timeoutMs = 30000): Promise<void> {
    if (this.isReady()) {
      return;
    }

    // If init hasn't been called yet, call it
    if (!this.initializationPromise && !this.isInitialized) {
      await this.init();
      return;
    }

    // Wait for ongoing initialization
    const startTime = Date.now();
    while (!this.isReady() && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!this.isReady()) {
      throw new Error(
        `EditorMatrixClient not ready after ${timeoutMs}ms timeout`,
      );
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    if (this.matrixClient) {
      try {
        // Remove persistent listener if it exists
        if (this.persistentSyncListener) {
          this.matrixClient.removeListener(
            ClientEvent.Sync,
            this.persistentSyncListener,
          );
          this.persistentSyncListener = null;
        }

        this.matrixClient.stopClient();
        this.logger.debug('✓ Matrix client stopped');
      } catch (cleanupError) {
        this.logger.error('Error during client cleanup:', cleanupError);
      }

      this.matrixClient = null;
    }

    this.isInitialized = false;
  }

  /**
   * Stop the Matrix client
   */
  public async stop(): Promise<void> {
    if (!this.matrixClient && !this.isInitialized) {
      this.logger.debug('EditorMatrixClient not initialized, nothing to stop');
      return;
    }

    try {
      this.logger.log('Stopping EditorMatrixClient...');
      await this.cleanup();
      this.logger.log('✅ EditorMatrixClient stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping EditorMatrixClient:', error);
      throw error;
    }
  }

  /**
   * Destroy the singleton instance
   * Use this for testing or when you need to completely reset the client
   */
  public static async destroy(): Promise<void> {
    if (EditorMatrixClient.instance) {
      await EditorMatrixClient.instance.stop();
      EditorMatrixClient.instance = null;
    }
  }
}
