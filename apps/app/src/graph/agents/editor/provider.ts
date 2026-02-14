import { MatrixProvider } from '@ixo/matrix-crdt';
import type { MatrixClient } from 'matrix-js-sdk';
import * as Y from 'yjs';

import { Logger } from '@nestjs/common';

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type RoomDescriptor =
  | { type: 'id'; id: string }
  | { type: 'alias'; alias: string };

export interface ProviderInitResult {
  doc: Y.Doc;
  awareness?: unknown;
  provider: MatrixProvider;
}
export interface MatrixRoomById {
  type: 'id';
  value: string;
}

export interface MatrixRoomByAlias {
  type: 'alias';
  value: string;
}
export interface ProviderConfig {
  docName: string;
  enableAwareness: boolean;
  retryAttempts: number;
  retryDelayMs: number;
}

export type MatrixRoomConfig = MatrixRoomById | MatrixRoomByAlias;

export interface MatrixConfig {
  baseUrl: string;
  accessToken: string;
  userId: string;
  room: MatrixRoomConfig;
  initialSyncTimeoutMs: number;
}
export interface BlockNoteConfig {
  defaultBlockId?: string;
  blockNamespace?: string;
  mutableAttributeKeys: string[];
}

export interface AppConfig {
  matrix: MatrixConfig;
  provider: ProviderConfig;
  blocknote: BlockNoteConfig;
}

/**
 * MatrixProviderManager
 *
 * Manages a Y.Doc CRDT for a specific Matrix room.
 *
 * IMPORTANT: This class assumes the Matrix client is ALREADY synced
 * via the EditorMatrixClient singleton. It does NOT manage client lifecycle.
 *
 * Each instance creates:
 * - A new Y.Doc for the room
 * - A MatrixProvider to sync Y.Doc with Matrix
 *
 * The singleton EditorMatrixClient handles:
 * - Matrix connection
 * - Background sync
 * - Client lifecycle
 */
export class MatrixProviderManager {
  private readonly doc: Y.Doc;
  private provider: MatrixProvider | undefined;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private documentAvailable = false;
  private disposed = false;
  private availabilityResolvers: Array<() => void> = [];

  constructor(
    private readonly matrixClient: MatrixClient,
    private readonly cfg: AppConfig,
  ) {
    this.doc = new Y.Doc();
  }

  public get ydoc(): Y.Doc {
    return this.doc;
  }

  public get matrixProvider(): MatrixProvider | undefined {
    return this.provider;
  }

  /**
   * Initialize the provider for the configured room.
   *
   * Assumes the Matrix client is already synced (via EditorMatrixClient singleton).
   * Creates a MatrixProvider to sync the Y.Doc with the Matrix room.
   */
  public async init(): Promise<ProviderInitResult> {
    if (this.disposed) {
      throw new Error('MatrixProviderManager was already disposed');
    }

    const attempts = Math.max(1, this.cfg.provider.retryAttempts);
    const delayMs = Math.max(0, this.cfg.provider.retryDelayMs);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // Initialize the provider (creates MatrixProvider, fetches room history)
        await this.initializeProvider();

        // Wait for document to become available
        await this.waitForAvailability(this.cfg.matrix.initialSyncTimeoutMs);

        Logger.log('Matrix provider initialized', { attempt });
        Logger.log(`📄 Y.Doc GUID: ${this.doc.guid}`);
        Logger.log(`📄 Room ID: ${JSON.stringify(this.cfg.matrix.room)}`);

        return {
          doc: this.doc,
          awareness: this.provider?.awarenessInstance,
          provider: this.ensureProvider(),
        };
      } catch (error) {
        Logger.warn(
          `Matrix provider init attempt ${attempt} failed`,
          error as Error,
        );
        await this.cleanupProvider();

        if (attempt === attempts) {
          throw error;
        }

        const backoff = delayMs * attempt;
        Logger.log(`Retrying provider initialization in ${backoff}ms`);
        await wait(backoff);
      }
    }

    throw new Error('Matrix provider initialization failed');
  }

  /**
   * Ensures the room is available in the Matrix client's store.
   * This is critical for createMessagesRequest() to work correctly.
   */
  private async ensureRoomAvailable(roomId: string): Promise<void> {
    const room = this.matrixClient.getRoom(roomId);

    if (!room) {
      Logger.warn(`Room ${roomId} not in client store, attempting to peek...`);

      try {
        // Try to peek into the room to populate the client's store
        await this.matrixClient.peekInRoom(roomId);
        Logger.log(`Successfully peeked into room ${roomId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Room ${roomId} not accessible. Ensure the client has joined the room and is synced. Error: ${errorMsg}`,
        );
      }
    } else {
      Logger.debug(`Room ${roomId} found in client store`);
    }
  }

  private async initializeProvider() {
    this.cleanupProviderListeners();

    const roomDescriptor = this.resolveRoomDescriptor();

    // Resolve room ID (handle both 'id' and 'alias' types)
    let roomId: string;
    if (roomDescriptor.type === 'id') {
      roomId = roomDescriptor.id;
    } else {
      // Resolve room alias to room ID
      const ret = await this.matrixClient.getRoomIdForAlias(
        roomDescriptor.alias,
      );
      roomId = ret.room_id;
    }

    // Ensure the room is in the client's store before proceeding
    // This is critical for MatrixProvider to fetch room history correctly
    await this.ensureRoomAvailable(roomId);

    Logger.log('Creating MatrixProvider', roomDescriptor);

    this.provider = new MatrixProvider(
      this.doc,
      this.matrixClient,
      roomDescriptor,
      {
        enableAwareness: this.cfg.provider.enableAwareness,
        reader: {
          snapshotInterval: 10,
        },

        writer: {
          flushInterval: 10,
        },
      },
    );

    this.registerProviderListeners(this.provider);

    await this.provider.initialize();
  }

  private waitForAvailability(timeoutMs: number): Promise<void> {
    if (this.documentAvailable) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.availabilityResolvers = this.availabilityResolvers.filter(
          (candidate) => candidate !== resolver,
        );
        reject(
          new Error(
            `Document did not become available within ${timeoutMs}ms. Check room permissions or connectivity.`,
          ),
        );
      }, timeoutMs);

      const resolver = () => {
        clearTimeout(timeoutHandle);
        resolve();
      };

      this.availabilityResolvers.push(resolver);
    });
  }

  private registerProviderListeners(provider: MatrixProvider) {
    this.disposables.push(
      provider.onDocumentAvailable(() => {
        Logger.log('Matrix document available');

        // Wait briefly for Y.Doc to apply initial sync
        // Can't rely on onReceivedEvents - it only fires for NEW events,
        // not when connecting to an already-synced client
        setTimeout(() => {
          Logger.log('Marking document as available after sync delay');
          this.documentAvailable = true;
          const resolvers = [...this.availabilityResolvers];
          this.availabilityResolvers = [];
          resolvers.forEach((resolver) => {
            resolver();
          });
        }, 500); // Short delay for Y.Doc sync
      }),
    );

    this.disposables.push(
      provider.onDocumentUnavailable(() => {
        Logger.warn('Matrix document unavailable');
        this.documentAvailable = false;
      }),
    );

    this.disposables.push(
      provider.onReceivedEvents(() => {
        Logger.debug('Received Matrix events - Y.Doc syncing content');
      }),
    );
  }

  private cleanupProviderListeners() {
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      try {
        disposable?.dispose();
      } catch (error) {
        Logger.warn('Failed to dispose provider listener', error as Error);
      }
    }
  }

  private resolveRoomDescriptor(): RoomDescriptor {
    if (this.cfg.matrix.room.type === 'id') {
      return { type: 'id', id: this.cfg.matrix.room.value };
    }

    return { type: 'alias', alias: this.cfg.matrix.room.value };
  }

  private ensureProvider(): MatrixProvider {
    if (!this.provider) {
      throw new Error('Matrix provider not initialized');
    }
    return this.provider;
  }

  /**
   * Dispose of this provider manager.
   *
   * Cleans up:
   * - MatrixProvider (stops polling, removes listeners)
   * - Y.Doc (destroys local document state)
   *
   * Does NOT touch the Matrix client - it's managed by EditorMatrixClient singleton
   * and shared across all providers/rooms.
   */
  public async dispose() {
    if (this.disposed) {
      return;
    }

    Logger.log('Disposing Matrix provider manager');

    // Clean up provider and Y.Doc
    await this.cleanupProvider();
    this.doc.destroy();

    // NOTE: We NEVER call matrixClient.stopClient() here!
    // The Matrix client is managed by EditorMatrixClient singleton
    // and is shared across all rooms. Stopping it would break
    // all other active providers.

    this.disposed = true;
  }

  private async cleanupProvider() {
    this.cleanupProviderListeners();

    if (this.provider) {
      try {
        this.provider.dispose();
      } catch (error) {
        Logger.warn('Error while disposing MatrixProvider', error as Error);
      } finally {
        this.provider = undefined;
      }
    }

    if (!this.documentAvailable) {
      return;
    }

    this.documentAvailable = false;
  }
}
