import { Logger } from '@ixo/logger';
import { MatrixEvent, MessageEvent, MessageEventContent } from 'matrix-bot-sdk';
import * as sdk from 'matrix-js-sdk';
import {
  MatrixStateManager,
  matrixStateManager,
} from './matrix-state-manager/matrix-state-manager.js';
import { IAction, type IMessageOptions } from './types/matrix.js';
import { Cache } from './utils/cache.js';
import {
  createSimpleMatrixClient,
  ISimpleMatrixClientConfig,
  SimpleMatrixClient,
} from './utils/create-simple-matrix-client.js';
import { formatMsg } from './utils/format-msg.js';

function getEntityRoomAliasFromDid(did: string) {
  return did.replace(/:/g, '-');
}

/**
 * MatrixManager - Thread-Safe Singleton for Matrix Operations
 *
 */
export class MatrixManager {
  private mxClient: SimpleMatrixClient | undefined;

  // Singleton instance management
  private static instance: MatrixManager | undefined;
  private static instanceLock = false;

  // Initialization state management
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationLock = false;

  private homeserverName: string;
  private roomCache: Cache;
  private oracleName: string;

  private constructor(
    public stateManager: MatrixStateManager = matrixStateManager,
  ) {
    // Private constructor to prevent direct instantiation
    const url = new URL(process.env.MATRIX_BASE_URL ?? '');
    this.homeserverName = process.env.MATRIX_HOMESERVER_NAME ?? url.hostname;
    this.roomCache = new Cache();
    this.oracleName = process.env.ORACLE_NAME ?? 'Oracle';
  }

  /**
   * Get the singleton instance of MatrixManager
   * Thread-safe implementation with proper locking
   */
  public static getInstance(): MatrixManager {
    // Double-checked locking pattern for thread safety
    if (!MatrixManager.instance) {
      if (MatrixManager.instanceLock) {
        // Another thread is already creating the instance, wait for it
        while (MatrixManager.instanceLock && !MatrixManager.instance) {
          // Yield control to event loop
          // Wait for the other thread to finish initialization
        }
        if (MatrixManager.instance) {
          return MatrixManager.instance;
        }
      }

      // Acquire lock and create instance
      MatrixManager.instanceLock = true;
      try {
        // Double-check after acquiring lock
        if (!MatrixManager.instance) {
          MatrixManager.instance = new MatrixManager();
        }
      } finally {
        MatrixManager.instanceLock = false;
      }
    }
    return MatrixManager.instance;
  }

  /**
   * Initialize the Matrix client - MUCH simpler now with matrix-bot-sdk!
   */
  public async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      Logger.info('MatrixManager already initialized');
      return;
    }

    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      Logger.info('MatrixManager initialization in progress, waiting...');
      return this.initializationPromise;
    }

    // If another thread is initializing, wait for it
    if (this.initializationLock) {
      while (this.initializationLock && !this.isInitialized) {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      }
      if (this.isInitialized) {
        return;
      }
    }

    // Acquire initialization lock
    this.initializationLock = true;

    // Create and store the initialization promise
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationLock = false;
      this.initializationPromise = null;
    }
  }

  private async performInitialization(): Promise<void> {
    try {
      Logger.info(
        '🚀 Starting MatrixManager initialization with matrix-bot-sdk...',
      );

      const config: ISimpleMatrixClientConfig = {
        baseUrl: process.env.MATRIX_BASE_URL!,
        accessToken: process.env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN!,
        userId: process.env.MATRIX_ORACLE_ADMIN_USER_ID!,
        storagePath: process.env.MATRIX_STORE_PATH!,
        autoJoin: true,
      };

      // Create client and start it
      this.mxClient = createSimpleMatrixClient(config);
      await this.mxClient.start();

      this.stateManager = MatrixStateManager.getInstance();

      // Mark as initialized only after everything succeeds
      this.isInitialized = true;
      Logger.info('✅ MatrixManager initialization completed');
    } catch (error) {
      Logger.error('❌ MatrixManager initialization failed:', error);

      // Cleanup partial initialization
      if (this.mxClient) {
        try {
          await this.mxClient.stop();
        } catch (cleanupError) {
          Logger.error('Error during simple client cleanup:', cleanupError);
        }
        this.mxClient = undefined;
      }

      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Get initialization status
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
   * Destroy the MatrixManager instance for testing or restart
   */
  public async destroy(): Promise<void> {
    try {
      Logger.info('Destroying MatrixManager...');

      // Reset initialization state
      this.initializationPromise = null;
      this.isInitialized = false;

      await this.shutdown();

      this.mxClient = undefined;

      Logger.info('MatrixManager destroyed');
    } catch (error) {
      Logger.error('Error destroying MatrixManager:', error);
      throw error;
    }
  }

  public onRoomEvent<T>(
    roomId: string,
    eventType: string,
    callback: (event: MatrixEvent<T>) => void,
    debug?: boolean,
  ): () => void {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    const fn = async (rmId: string, event: MatrixEvent<any>) => {
      if (debug) {
        Logger.info('onRoomEvent', {
          roomId,
          eventType,
          event,
        });
      }
      if (rmId !== roomId) return;

      // Check if this is an encrypted event that failed to decrypt
      if (event.type === 'm.room.encrypted' && !event.content?.body) {
        return;
      }

      // Check if this is an encrypted event that failed to decrypt
      if (event.type === 'm.room.encrypted' && !event.content?.body) {
        return;
      }

      if (event.type !== eventType) return;

      callback(event);
    };

    this.mxClient.mxClient.on('room.event', fn);

    return () => {
      Logger.info('Removing room event listener for roomId:', roomId);
      this.mxClient?.mxClient.removeListener('room.event', fn);
    };
  }

  public async getOracleRoomId({
    userDid,
    oracleEntityDid,
  }: {
    userDid: string;
    oracleEntityDid: string;
  }): Promise<{
    roomId: string | undefined;
    roomAlias: string;
    oracleRoomFullAlias: string;
  }> {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    const oracleRoomAlias = `${getEntityRoomAliasFromDid(userDid)}_${getEntityRoomAliasFromDid(oracleEntityDid)}`;
    const oracleRoomFullAlias = `#${oracleRoomAlias}:${this.homeserverName}`;

    // Check cache first
    const cachedRoomId = this.roomCache.get(oracleRoomFullAlias);
    if (cachedRoomId) {
      Logger.debug(
        '🔍 Found cached room id for oracle room alias:',
        oracleRoomFullAlias,
      );
      return {
        roomId: cachedRoomId,
        roomAlias: oracleRoomAlias,
        oracleRoomFullAlias,
      };
    }

    try {
      const roomId = await this.mxClient.resolveRoomAlias(oracleRoomFullAlias);
      Logger.debug(
        '🔍 Resolved room id for oracle room alias:',
        oracleRoomFullAlias,
      );
      this.roomCache.set(oracleRoomFullAlias, roomId);

      return {
        roomId,
        roomAlias: oracleRoomAlias,
        oracleRoomFullAlias,
      };
    } catch (error) {
      Logger.error(
        `Failed to resolve room alias ${oracleRoomFullAlias}:`,
        error,
      );
      return {
        roomId: undefined,
        roomAlias: oracleRoomAlias,
        oracleRoomFullAlias,
      };
    }
  }

  /**
   * Send a message using matrix-bot-sdk - MUCH simpler!
   */
  async sendMessage(options: IMessageOptions): Promise<string> {
    try {
      if (!this.mxClient) {
        throw new Error('Simple client not initialized');
      }

      // Use the simplified sendMessage API from matrix-bot-sdk
      const { content, htmlContent } = formatMsg({
        message: options.message,
        isOracleAdmin: Boolean(options.isOracleAdmin),
        oracleName: options.oracleName ?? this.oracleName,
        disablePrefix: options.disablePrefix,
      });

      return await this.mxClient.sendMessage({
        roomId: options.roomId,
        message: content,
        type: 'html',
        formattedBody: htmlContent,
        threadId: options.threadId,
      });
    } catch (error) {
      Logger.error('❌ Error sending message:', error);
      throw error;
    }
  }

  async editMessage(
    options: IMessageOptions & { messageId: string },
  ): Promise<string> {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    // Use the simplified sendMessage API from matrix-bot-sdk
    const { content, htmlContent } = formatMsg({
      message: options.message,
      isOracleAdmin: Boolean(options.isOracleAdmin),
      oracleName: options.oracleName ?? this.oracleName,
      disablePrefix: options.disablePrefix,
    });

    const ev = {
      msgtype: 'm.text',
      body: content,
      format: 'org.matrix.custom.html',
      formatted_body: htmlContent,
      'm.new_content': {
        msgtype: 'm.text',
        body: content,
        format: 'org.matrix.custom.html',
        formatted_body: htmlContent,
        'm.mentions': {},
      },
      'm.mentions': {},
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: options.messageId,
      },
    };

    return await this.mxClient.mxClient.sendEvent(
      options.roomId,
      'm.room.message',
      ev,
    );
  }

  /**
   * Listen for room messages using matrix-bot-sdk
   */
  public onMessage(
    callback: (
      roomId: string,
      event: MessageEvent<MessageEventContent>,
    ) => void,
  ): () => void {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    Logger.info('🎧 Setting up message listener with matrix-bot-sdk');
    return this.mxClient.onMessage(callback);
  }

  public listenToMatrixEvent<T extends sdk.EmittedEvents>(
    eventType: T,
    callback: sdk.ClientEventHandlerMap[T],
  ): (() => void) | undefined {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    this.mxClient?.mxClient?.on(eventType, callback);

    return () => {
      this.mxClient?.mxClient?.removeListener(eventType, callback);
    };
  }

  /**
   * Send a state event using matrix-bot-sdk
   */
  public async sendMatrixEvent(
    roomId: string,
    eventType: string,
    content: object,
  ): Promise<string> {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    return await this.mxClient.mxClient.sendEvent(roomId, eventType, content);
  }

  public async sendActionLog(
    roomId: string,
    action: IAction,
    threadId?: string,
  ): Promise<string> {
    return await this.sendMatrixEvent(roomId, 'ixo.action.log', {
      action,
      threadId,
    });
  }

  public async getEventById<T extends Object | unknown = unknown>(
    roomId: string,
    eventId: string,
  ): Promise<MatrixEvent<T>> {
    return await this.mxClient?.mxClient.getEvent(roomId, eventId);
  }

  public async getLoginResponse(
    accessToken: string,
  ): Promise<{ user_id: string }> {
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

    tempClient.stopClient();
    tempClient.removeAllListeners();
    tempClient.http.abort();

    return loginResponse;
  }

  public async getDisplayName(userId: string): Promise<string> {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }
    const profile = await this.mxClient.mxClient.getUserProfile(userId);
    return profile.displayname;
  }

  /**
   * Join a room using matrix-bot-sdk
   */
  public async joinRoom(roomIdOrAlias: string): Promise<string> {
    if (!this.mxClient) {
      throw new Error('Simple client not initialized');
    }

    return await this.mxClient.joinRoom(roomIdOrAlias);
  }

  /**
   * Get the underlying SimpleMatrixClient for advanced operations
   */
  public getClient(): SimpleMatrixClient | undefined {
    return this.mxClient;
  }

  /**
   * Gracefully stop the Matrix client to avoid crypto corruption
   */
  public async shutdown(): Promise<void> {
    if (!this.mxClient) {
      return;
    }

    try {
      Logger.info(
        'MatrixManager graceful shutdown: stopping Matrix client sync...',
      );
      await this.mxClient.stop();
      Logger.info(
        'MatrixManager graceful shutdown: Matrix client sync stopped',
      );

      Logger.info(
        'MatrixManager graceful shutdown: waiting for pending sync operations...',
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const cryptoClient = (this.mxClient.mxClient as any)?.crypto;
      if (cryptoClient?.engine?.machine?.close) {
        Logger.info('MatrixManager graceful shutdown: closing crypto store...');
        cryptoClient.engine.machine.close();
        Logger.info('MatrixManager graceful shutdown: crypto store closed');
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.isInitialized = false;
      Logger.info('MatrixManager graceful shutdown complete');
    } catch (error) {
      Logger.error('Error during MatrixManager graceful shutdown:', error);
      throw error;
    }
  }
}
