import { Logger } from '@ixo/logger';
import olm from '@matrix-org/olm';
import * as sdk from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { promisify } from 'node:util';
import { CrossSigningManager } from './crypto/cross-signing';
import { MatrixStateManager, matrixStateManager } from './matrix-state-manager';
import { type IMessageOptions } from './types/matrix';
import { Cache } from './utils/cache';
import { createOracleAdminClient } from './utils/create-oracle-admin-client';
import { formatMsg } from './utils/format-msg';
import { syncMatrixState } from './utils/sync';

function getEntityRoomAliasFromDid(did: string) {
  return did.replace(/:/g, '-');
}

// Constants
const INITIAL_SYNC_LIMIT = 1;

logger.setLevel('ERROR');

// olm is a global variable required by the matrix-js-sdk
global.Olm = olm;

/**
 * MatrixManager - Thread-Safe Singleton for Matrix Operations
 *
 * This class ensures that only ONE Matrix client instance exists across your entire application,
 * no matter how many times it's imported or from where. It handles all race conditions and
 * concurrent initialization attempts safely.
 *
 * @example
 * ```typescript
 * // From any file in your app:
 * import { MatrixManager } from './matrix-manager';
 *
 * // Always returns the same instance
 * const matrix1 = MatrixManager.getInstance();
 * const matrix2 = MatrixManager.getInstance();
 * console.log(matrix1 === matrix2); // true
 *
 * // Safe concurrent initialization
 * await Promise.all([
 *   matrix1.init(),
 *   matrix2.init(),
 *   MatrixManager.getInstance().init()
 * ]); // Only initializes once, all promises resolve
 *
 * // Check status
 * const status = matrix1.getInitializationStatus();
 * console.log('Initialized:', status.isInitialized);
 * console.log('Initializing:', status.isInitializing);
 * ```
 *
 * @example
 * ```typescript
 * // Safe usage pattern
 * const matrix = MatrixManager.getInstance();
 *
 * if (!matrix.getInitializationStatus().isInitialized) {
 *   await matrix.init();
 * }
 *
 * // Now safe to use matrix operations
 * await matrix.sendMessage({...});
 * ```
 */
export class MatrixManager {
  private adminClient: sdk.MatrixClient | undefined;

  // Singleton instance management
  private static instance: MatrixManager | undefined;
  private static instanceLock = false;

  // Initialization state management
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationLock = false;

  private homeserverName: string;
  private roomCache: Cache;

  private constructor(
    public stateManager: MatrixStateManager = matrixStateManager,
  ) {
    // Private constructor to prevent direct instantiation
    const url = new URL(process.env.MATRIX_BASE_URL ?? '');
    this.homeserverName = process.env.MATRIX_HOMESERVER_NAME ?? url.hostname;
    this.roomCache = new Cache();
  }

  /**
   * Get the singleton instance of MatrixManager
   * Thread-safe implementation with proper locking
   */
  public static getInstance(): MatrixManager {
    // Double-checked locking pattern for thread safety
    if (!MatrixManager.instance) {
      if (MatrixManager.instanceLock) {
        // If another thread is creating the instance, wait and return the created instance
        // In a real multi-threaded environment, you'd want to use proper synchronization
        // For Node.js event loop, this prevents race conditions
        while (MatrixManager.instanceLock && !MatrixManager.instance) {
          // Yield control to event loop
          promisify(setImmediate)();
        }
        if (MatrixManager.instance) {
          return MatrixManager.instance;
        }
      }

      MatrixManager.instanceLock = true;

      // Double check after acquiring lock
      if (!MatrixManager.instance) {
        MatrixManager.instance = new MatrixManager();
        Logger.info('MatrixManager singleton instance created');
      }

      MatrixManager.instanceLock = false;
    }

    return MatrixManager.instance;
  }

  /**
   * Initialize the MatrixManager
   * Thread-safe implementation that prevents race conditions
   */
  public async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      return;
    }

    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Prevent concurrent initialization attempts
    if (this.initializationLock) {
      // Wait for the current initialization to complete
      while (this.initializationLock && !this.isInitialized) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return;
    }

    // Start initialization
    this.initializationLock = true;

    try {
      this.initializationPromise = this._performInitialization();
      await this.initializationPromise;
    } catch (error) {
      // Reset state on failure so initialization can be retried
      this.initializationPromise = null;
      this.isInitialized = false;
      this.initializationLock = false;
      throw error;
    }

    this.initializationLock = false;
  }

  /**
   * Internal initialization method
   * This is where the actual initialization work happens
   */
  private async _performInitialization(): Promise<void> {
    // Double check to prevent unnecessary work
    if (this.isInitialized) {
      return;
    }

    try {
      Logger.info('Starting MatrixManager initialization...');

      this.adminClient = await createOracleAdminClient();
      this.stateManager = MatrixStateManager.getInstance();

      await this.initializeClient(this.adminClient);

      // Mark as initialized only after everything succeeds
      this.isInitialized = true;
      Logger.info('MatrixManager initialization completed successfully');
    } catch (error) {
      Logger.error('MatrixManager initialization failed:', error);

      // Cleanup partial initialization
      if (this.adminClient) {
        try {
          cleanupClient(this.adminClient);
        } catch (cleanupError) {
          Logger.error(
            'Error during cleanup after failed initialization:',
            cleanupError,
          );
        }
        this.adminClient = undefined;
      }

      throw new sdk.MatrixError({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error happened during initialization',
      });
    }
  }

  /**
   * Check if the MatrixManager is initialized
   */
  public getInitializationStatus(): {
    isInitialized: boolean;
    isInitializing: boolean;
  } {
    return {
      isInitialized: this.isInitialized,
      isInitializing:
        this.initializationLock || Boolean(this.initializationPromise),
    };
  }

  /**
   * Stop and cleanup the MatrixManager
   * Can be called to reset the singleton state
   */
  public async stop(): Promise<void> {
    try {
      // Wait for any ongoing initialization to complete first
      if (this.initializationPromise && !this.isInitialized) {
        try {
          await this.initializationPromise;
        } catch {
          // Ignore initialization errors during shutdown
        }
      }

      if (this.adminClient) {
        cleanupClient(this.adminClient);
        this.adminClient = undefined;
      }

      this.isInitialized = false;
      this.initializationPromise = null;
      this.initializationLock = false;

      // Clear caches
      this.roomCache.clear();

      Logger.info('MatrixManager stopped and cleaned up');
    } catch (error) {
      Logger.error('Error during MatrixManager stop:', error);
      throw error;
    }
  }

  /**
   * Reset the singleton instance (for testing purposes mainly)
   * ⚠️ Use with extreme caution in production!
   */
  public static async resetInstance(): Promise<void> {
    if (MatrixManager.instance) {
      await MatrixManager.instance.stop();
      MatrixManager.instance = undefined;
      MatrixManager.instanceLock = false;
      Logger.warn('MatrixManager singleton instance has been reset');
    }
  }

  public async getOracleRoomId({
    userDid,
    oracleDid,
  }: {
    userDid: string;
    oracleDid: string;
  }): Promise<{
    roomId: string | undefined;
    roomAlias: string;
    oracleRoomFullAlias: string;
  }> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }

    const oracleRoomAlias = `${getEntityRoomAliasFromDid(userDid)}_${getEntityRoomAliasFromDid(oracleDid)}`;
    const oracleRoomFullAlias = `#${oracleRoomAlias}:${this.homeserverName}`;

    // Check cache first
    const cachedRoomId = this.roomCache.get(oracleRoomFullAlias);
    if (cachedRoomId) {
      return {
        roomId: cachedRoomId,
        roomAlias: oracleRoomAlias,
        oracleRoomFullAlias,
      };
    }

    const { room_id: roomId } =
      await this.adminClient.getRoomIdForAlias(oracleRoomFullAlias);

    this.roomCache.set(oracleRoomFullAlias, roomId);

    return {
      roomId,
      roomAlias: oracleRoomAlias,
      oracleRoomFullAlias,
    };
  }

  public startAdminClient(): Promise<void> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }
    return this.initializeClient(this.adminClient);
  }

  public getOracleRoom(roomId: string): sdk.Room | null {
    if (!this.adminClient?.clientRunning) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }
    return this.adminClient.getRoom(roomId);
  }

  public static generateRoomAliasFromName(roomName: string): string {
    return roomName.replace(/\s/g, '_');
  }

  public async sendMatrixEvent(
    roomId: string,
    eventType: string,
    content: object,
  ) {
    return this.adminClient?.sendEvent(
      roomId,
      eventType as keyof sdk.TimelineEvents,
      content as sdk.TimelineEvents[keyof sdk.TimelineEvents],
    );
  }

  public listenToMatrixEvent<T extends sdk.EmittedEvents>(
    eventType: T,
    callback: sdk.ClientEventHandlerMap[T],
  ): (() => void) | undefined {
    this.adminClient?.on(eventType, callback as any);

    return () => {
      this.adminClient?.removeListener(eventType, callback as any);
    };
  }

  public async onMessage(
    callback: (event: sdk.MatrixEvent, room: sdk.Room) => void,
  ): Promise<() => void> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }

    // Create a wrapper callback that filters by roomId
    const roomSpecificCallback = async (
      event: sdk.MatrixEvent,
      room: sdk.Room | undefined,
      _toStartOfTimeline: boolean | undefined,
      removed: boolean,
      _data: sdk.IRoomTimelineData,
    ) => {
      // Only process messages from the specified room
      if (room && event.getType() === 'm.room.message' && !removed) {
        callback(event, room);
      }

      // m.room.encrypted
      if (room && event.getType() === 'm.room.encrypted' && !removed) {
        event.once(sdk.MatrixEventEvent.Decrypted, (ev) => {
          callback(ev, room);
        });
      }
    };

    // Listen to room timeline events (which includes messages)
    this.adminClient.on(sdk.RoomEvent.Timeline, roomSpecificCallback);

    // Return a cleanup function to remove the listener
    return () => {
      this.adminClient?.removeListener(
        sdk.RoomEvent.Timeline,
        roomSpecificCallback,
      );
    };
  }

  async sendMessage(options: IMessageOptions): Promise<sdk.ISendEventResponse> {
    try {
      if (!this.adminClient) {
        throw new sdk.MatrixError({ error: 'Admin client not initialized' });
      }

      return await this.adminClient.sendMessage(options.roomId, {
        msgtype: sdk.MsgType.Text,
        body: formatMsg(options.message, Boolean(options.isOracleAdmin)),
        'm.relates_to': options.threadId
          ? {
              'm.in_reply_to': {
                rel_type: 'm.thread',
                event_id: options.threadId,
                is_falling_back: false,
              },
            }
          : undefined,
        // Using this var so in MessagesService we can filter out messages from the bot -- as there is an event listener for message so if we received a message from user in the matrix room the bot can respond to it and filter out the message the we sent from here otherwise the bot will respond to itself infinite times
        INTERNAL: true,
      } as any);
    } catch (error) {
      Logger.error('Error sending message:', error);
      throw error;
    }
  }

  async sendActionLog(
    roomId: string,
    action: object,
    threadId?: string,
  ): Promise<void> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }

    const txId = this.adminClient.makeTxnId();
    if (!txId) {
      throw new sdk.MatrixError({ error: 'Failed to generate transaction ID' });
    }

    // action event
    await this.adminClient.sendEvent(
      roomId,
      threadId ?? null,
      'ixo.agent.action' as keyof sdk.TimelineEvents,
      {
        action,
        ts: Date.now(),
      } as unknown as sdk.TimelineEvents[keyof sdk.TimelineEvents],
      txId,
    );
  }

  public async getLoginResponse(
    accessToken: string,
  ): Promise<sdk.LoginResponse> {
    const tempClient = sdk.createClient({
      baseUrl: process.env.MATRIX_BASE_URL ?? '',
      accessToken,
    });

    const loginResponse = await tempClient.whoami();
    if (!loginResponse.user_id || !loginResponse.device_id) {
      throw new sdk.MatrixError({
        error: 'Invalid access token: User ID or device ID not found',
      });
    }

    cleanupClient(tempClient);
    return {
      user_id: loginResponse.user_id,
      access_token: accessToken,
      device_id: loginResponse.device_id,
    };
  }

  private async initializeClient(client: sdk.MatrixClient): Promise<void> {
    if (client.clientRunning) {
      return;
    }

    await this.setupClientCrypto(client);
    await this.startClientWithConfig(client);
    await this.setupCrossSigning(client);
    await this.finalizeClientSetup(client);

    // listen to room invitations
    client.on(sdk.RoomMemberEvent.Membership, (_, member: sdk.RoomMember) => {
      if (
        member.membership === 'invite' &&
        member.userId === client.getUserId()
      ) {
        const roomId = member.roomId;
        Logger.info(`Received invite to ${roomId}, attempting to join...`);

        client
          .joinRoom(roomId)
          .then(() => {
            Logger.info(`Successfully joined room: ${roomId}`);
          })
          .catch((err) => {
            Logger.error(`Failed to join room ${roomId}:`, err);
          });
      }
    });
    // join invited rooms on startup
    await this.joinInvitedRooms();
  }

  private async setupClientCrypto(client: sdk.MatrixClient): Promise<void> {
    const userId = client.getUserId() ?? '';
    Logger.info(`Filter for user ${userId}:`);
    await client.initCrypto();
    Logger.info(`Crypto initialized for user ${userId}`);
  }

  private async startClientWithConfig(client: sdk.MatrixClient): Promise<void> {
    await client.startClient({
      lazyLoadMembers: false,
      initialSyncLimit: INITIAL_SYNC_LIMIT,
      includeArchivedRooms: false,
    });
    await syncMatrixState(client);
  }

  private async setupCrossSigning(client: sdk.MatrixClient): Promise<void> {
    if (!process.env.MATRIX_RECOVERY_PHRASE) {
      throw new sdk.MatrixError({ error: 'Recovery phrase not found' });
    }

    const crossSigningManager = new CrossSigningManager(
      client,
      process.env.MATRIX_RECOVERY_PHRASE,
    );
    await crossSigningManager.ensureCrossSigningIsSetup();
  }

  private async finalizeClientSetup(client: sdk.MatrixClient): Promise<void> {
    const userId = client.getUserId() ?? '';
    const deviceId = client.getDeviceId() ?? '';

    Logger.info(`Matrix client started for user ${userId}`);
    await client.setDeviceVerified(userId, deviceId, true);

    const cryptoApi = client.getCrypto();
    if (!cryptoApi) {
      throw new sdk.MatrixError({ error: 'Crypto API not found' });
    }

    client.setGlobalErrorOnUnknownDevices(false);
  }

  private async joinInvitedRooms() {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }
    const invitedRooms = this.adminClient
      .getRooms()
      .filter((room) => room.getMyMembership() === 'invite');
    Logger.info(`Joining ${invitedRooms.length} invited rooms...`);
    for await (const room of invitedRooms) {
      await this.adminClient.joinRoom(room.roomId);
      Logger.info(`Joined room: ${room.roomId}`);
    }
  }
}

function cleanupClient(client: sdk.MatrixClient): void {
  try {
    // Stop all ongoing syncs
    client.stopClient();

    // Remove all listeners
    client.removeAllListeners();

    // Close any open connections
    client.http.abort();
  } catch (error) {
    Logger.error('Error during client cleanup:', error);
    // Don't re-throw, this is cleanup code
  }
}
