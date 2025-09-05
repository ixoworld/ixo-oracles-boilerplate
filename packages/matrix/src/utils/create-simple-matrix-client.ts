import { Logger } from '@ixo/logger';
import {
  AutojoinRoomsMixin,
  LogService,
  MatrixClient,
  MessageEvent,
  type MessageEventContent,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
  UserID,
} from 'matrix-bot-sdk';
import * as sdk from 'matrix-js-sdk';
import * as path from 'node:path';
import { createMatrixClient } from './mx.js';

export interface ISimpleMatrixClientConfig {
  baseUrl: string;
  accessToken: string;
  userId: string;
  storagePath?: string;
  autoJoin?: boolean;
}

export interface IMessageOptions {
  roomId: string;
  message: string;
  threadId?: string;
}

/**
 * Simple Matrix Client using matrix-bot-sdk with RustSdkCryptoStorageProvider
 * Following the official examples - much cleaner than matrix-js-sdk!
 */
export class SimpleMatrixClient {
  public mxClient: MatrixClient;

  // Cache the bot's display name and ID for usage later
  public userId: string;
  public displayName: string;
  public localpart: string;
  public homeServerName: string;

  private storage: SimpleFsStorageProvider;
  private cryptoStore: RustSdkCryptoStorageProvider;
  private config: ISimpleMatrixClientConfig;
  private isStarted = false;

  constructor(config: ISimpleMatrixClientConfig) {
    this.config = config;
    this.prepareStorage();
    this.prepareCryptoStorage();
    this.createClient();
    this.extraConfig();
  }

  public async prepareProfile(): Promise<void> {
    this.userId = await this.mxClient.getUserId();
    const userId = new UserID(this.userId);
    this.localpart = userId.localpart;
    this.homeServerName = userId.domain;

    try {
      const profile = await this.mxClient.getUserProfile(this.userId);
      if (profile?.displayname) {
        this.displayName = profile.displayname;
      }
    } catch (e) {
      // Non-fatal error - we'll just log it and move on
      LogService.warn('Matrix Client prepareProfile', e);
    }
  }

  private prepareStorage(): void {
    // Prepare the storage system for the bot
    const storagePath = this.config.storagePath || './matrix-storage';
    this.storage = new SimpleFsStorageProvider(
      path.join(storagePath, 'bot.json'),
    );
  }

  private prepareCryptoStorage(): void {
    // Prepare a crypto store using Rust SDK
    const storagePath = this.config.storagePath || './matrix-storage';
    this.cryptoStore = new RustSdkCryptoStorageProvider(
      path.join(storagePath, 'encrypted'),
    );
  }

  private createClient(): void {
    if (!this.storage) throw new Error('Storage not prepared');
    this.mxClient = new MatrixClient(
      this.config.baseUrl,
      this.config.accessToken,
      this.storage,
      this.cryptoStore,
    );
  }

  private extraConfig(): void {
    // Setup the autojoin mixin (if enabled)
    if (this.config.autoJoin !== false) {
      // Default to true unless explicitly disabled
      AutojoinRoomsMixin.setupOnClient(this.mxClient);
    }
  }

  /**
   * Start the matrix client - much simpler than matrix-js-sdk!
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      Logger.warn('Matrix client already started');
      return;
    }

    try {
      Logger.info('🚀 Starting matrix-bot-sdk client...');

      // Setup cross-signing for device verification

      await this.prepareProfile();
      await this.mxClient.start();

      await this.setupCrossSigning({
        mxUserId: await this.mxClient.getUserId(),
        deviceId: this.mxClient.crypto.clientDeviceId,
      });

      this.isStarted = true;
      Logger.info('✅ Matrix client started successfully!');
    } catch (error) {
      Logger.error('❌ Failed to start matrix client:', error);
      throw error;
    }
  }

  /**
   * Stop the matrix client
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) return;

    try {
      await this.mxClient.stop();
      this.isStarted = false;
      Logger.info('✅ Matrix client stopped');
    } catch (error) {
      Logger.error('❌ Failed to stop matrix client:', error);
      throw error;
    }
  }

  /**
   * Send a message to a room
   */
  public async sendMessage(options: IMessageOptions): Promise<string> {
    if (!this.isStarted) {
      throw new Error('Matrix client not started');
    }

    try {
      Logger.info(`📤 Sending message to room ${options.roomId}`);

      // Use matrix-bot-sdk's sendText method
      const eventId = await this.mxClient.sendMessage(options.roomId, {
        body: options.message,
        'm.mentions': {},
        msgtype: 'm.text',
        ...(options.threadId
          ? {
              'm.relates_to': {
                event_id: options.threadId,
                is_falling_back: true,
                'm.in_reply_to': {
                  event_id: options.threadId,
                },
                rel_type: 'm.thread',
              },
            }
          : {}),
      });

      Logger.info(`✅ Message sent successfully: ${eventId}`);
      return eventId;
    } catch (error) {
      Logger.error(`❌ Failed to send message to ${options.roomId}:`, error);
      throw error;
    }
  }

  /**
   * Send a state event to a room
   */
  public async sendStateEvent(
    roomId: string,
    eventType: string,
    content: any,
    stateKey = '',
  ): Promise<string> {
    if (!this.isStarted) {
      throw new Error('Matrix client not started');
    }

    try {
      Logger.info(`📤 Sending state event ${eventType} to room ${roomId}`);

      const eventId = await this.mxClient.sendStateEvent(
        roomId,
        eventType,
        stateKey,
        content,
      );

      Logger.info(`✅ State event sent successfully: ${eventId}`);
      return eventId;
    } catch (error) {
      Logger.error(`❌ Failed to send state event to ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Join a room
   */
  public async joinRoom(roomIdOrAlias: string): Promise<string> {
    if (!this.isStarted) {
      throw new Error('Matrix client not started');
    }

    try {
      Logger.info(`🚪 Joining room ${roomIdOrAlias}`);

      const roomId = await this.mxClient.joinRoom(roomIdOrAlias);

      Logger.info(`✅ Joined room successfully: ${roomId}`);
      return roomId;
    } catch (error) {
      Logger.error(`❌ Failed to join room ${roomIdOrAlias}:`, error);
      throw error;
    }
  }

  /**
   * Resolve room alias to room ID
   */
  public async resolveRoomAlias(alias: string): Promise<string> {
    if (!this.isStarted) {
      throw new Error('Matrix client not started');
    }

    try {
      Logger.info(`🔍 Resolving room alias ${alias}`);

      const resolved = await this.mxClient.resolveRoom(alias);

      Logger.info(`✅ Room alias resolved: ${resolved}`);
      return resolved;
    } catch (error) {
      Logger.error(`❌ Failed to resolve room alias ${alias}:`, error);
      throw error;
    }
  }

  /**
   * Listen for room messages - return a function to remove the listener
   */
  public onMessage(
    callback: (
      roomId: string,
      event: MessageEvent<MessageEventContent>,
    ) => void,
  ): () => void {
    const fn = (roomId: string, event: any) => {
      const message = new MessageEvent(event);
      if (!message) return;

      callback(roomId, message);
    };
    this.mxClient.on('room.message', fn);

    return () => {
      this.mxClient.removeListener('room.message', fn);
    };
  }

  /**
   * Remove message listener
   */
  public removeListener(
    event: string,
    callback: (...args: any[]) => void,
  ): void {
    this.mxClient.removeListener(event, callback);
  }

  /**
   * Setup cross-signing for device verification using matrix-js-sdk
   * Based on proven implementation pattern
   */
  private async setupCrossSigning({
    mxUserId,
    deviceId,
  }: {
    mxUserId: string;
    deviceId: string;
  }): Promise<void> {
    try {
      Logger.info('🔐 Setting up cross-signing for device verification...');

      // Create temporary matrix-js-sdk client using same credentials
      const jsClient = await createMatrixClient({
        homeServerUrl: this.config.baseUrl,
        accessToken: this.config.accessToken,
        userId: mxUserId,
        deviceId,
      });

      const mxCrypto = jsClient.getCrypto();
      if (!mxCrypto) {
        Logger.warn('❌ Crypto not available in matrix-js-sdk client');
        jsClient.stopClient();
        jsClient.removeAllListeners();
        return;
      }

      // Check if cross-signing is already set up
      const hasCrossSigning = this.hasCrossSigningAccountData(jsClient);
      if (hasCrossSigning) {
        Logger.info('✅ Cross-signing already configured');
        jsClient.stopClient();
        jsClient.removeAllListeners();
        return;
      }

      Logger.info('🔑 Setting up cross-signing from scratch...');

      const securityPhrase = process.env.MATRIX_RECOVERY_PHRASE ?? 'secret';
      const password = process.env.MATRIX_ORACLE_ADMIN_PASSWORD;

      if (!password) {
        throw new Error(
          'MATRIX_ORACLE_ADMIN_PASSWORD required for cross-signing setup',
        );
      }

      // Step 1: Setup secret storage with recovery phrase
      Logger.info('🔐 Setting up secret storage...');
      const recoveryKey =
        await mxCrypto.createRecoveryKeyFromPassphrase(securityPhrase);

      await mxCrypto.bootstrapSecretStorage({
        createSecretStorageKey: async () => recoveryKey,
        setupNewSecretStorage: true,

      });

      // Step 2: Bootstrap cross-signing
      Logger.info('🔑 Bootstrapping cross-signing keys...');
      const userId = jsClient.getUserId()!;

      await mxCrypto.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: async (makeRequest) => {
          return await makeRequest(this.getAuthId({ userId, password }));
        },
        setupNewCrossSigning: true,
      });

      // Step 3: Reset key backup
      Logger.info('🔄 Resetting key backup...');
      await mxCrypto.resetKeyBackup();

      // Step 4: Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 5: Verify cross-signing was set up
      const success = !!jsClient.getAccountData('m.cross_signing.master');

      if (success) {
        Logger.info('✅ Cross-signing setup completed successfully!');
      } else {
        Logger.warn('⚠️ Cross-signing setup may not have completed properly');
      }

      // Clean up temporary client
      jsClient.stopClient();
      jsClient.removeAllListeners();
    } catch (error) {
      Logger.warn(
        '⚠️ Cross-signing setup failed (bot will still work):',
        error,
      );
      // Don't throw - cross-signing failure shouldn't break the bot
    }
  }

  /**
   * Check if cross-signing account data exists
   */
  private hasCrossSigningAccountData(client: sdk.MatrixClient): boolean {
    try {
      return !!client.getAccountData('m.cross_signing.master');
    } catch (error) {
      Logger.warn('⚠️ Could not check cross-signing account data:', error);
      return false;
    }
  }

  /**
   * Create authentication object for password-based auth
   */
  private getAuthId({
    userId,
    password,
  }: {
    userId: string;
    password: string;
  }) {
    return {
      type: 'm.login.password',
      identifier: {
        type: 'm.id.user',
        user: userId,
      },
      password: password,
    };
  }
}

/**
 * Create and configure a SimpleMatrixClient
 */
export function createSimpleMatrixClient(
  config: ISimpleMatrixClientConfig,
): SimpleMatrixClient {
  return new SimpleMatrixClient(config);
}
