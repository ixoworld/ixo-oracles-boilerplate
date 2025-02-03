import { Logger } from '@ixo/logger';
import olm from '@matrix-org/olm';
import * as sdk from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import crypto from 'node:crypto';
import { CrossSigningManager } from './crypto/cross-signign';
import { MatrixStateManager } from './matrix-state-manager';
import {
  type ICreateRoomAndJoinOptions,
  type IMessageOptions,
  type IRoomCreationOptions,
} from './types/matrix';
import createMatrixClient from './utils/create-matrix-client';
import { createOracleAdminClient } from './utils/create-oracle-admin-client';
import { formatMsg } from './utils/format-msg';
import { syncMatrixState } from './utils/sync';

// Constants
const ADMIN_POWER_LEVEL = 9999;
const INITIAL_SYNC_LIMIT = 1;

logger.setLevel('ERROR');

// olm is a global variable required by the matrix-js-sdk
global.Olm = olm;

export class MatrixManager {
  private adminClient: sdk.MatrixClient | undefined;
  public stateManager: MatrixStateManager;
  private static instance: MatrixManager | undefined;
  private isInitialized = false;

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static getInstance(): MatrixManager {
    if (!MatrixManager.instance) {
      MatrixManager.instance = new MatrixManager();
    }
    return MatrixManager.instance;
  }

  public async getRoomId({
    did,
    oracleName,
  }: {
    did: string;
    oracleName: string;
  }): Promise<string | undefined> {
    const roomName = MatrixManager.generateRoomNameFromDidAndOracle(
      did,
      oracleName,
    );
    return this.getRoomIdFromAlias(
      MatrixManager.generateRoomAliasFromName(roomName),
    );
  }

  async getRoomIdFromAlias(roomAlias: string): Promise<string | undefined> {
    try {
      const adminClient = this.adminClient ?? (await createOracleAdminClient());
      const userId = adminClient.getUserId();
      if (!userId) {
        throw new sdk.MatrixError({ error: 'User ID not found' });
      }
      const [, domain, port] = userId.split(':');
      let prefix = domain;
      if (port) {
        prefix += `:${port}`;
      }

      const { room_id: roomId } = await adminClient.getRoomIdForAlias(
        `#${roomAlias}:${prefix}`,
      );
      return roomId;
    } catch (error) {
      const err = error as sdk.MatrixError;
      if (err.errcode === 'M_INVALID_PARAM') {
        throw err;
      }
      return undefined;
    }
  }

  public startAdminClient(): Promise<void> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }
    return this.initializeClient(this.adminClient);
  }

  public getRoom(roomId: string): sdk.Room | null {
    if (!this.adminClient?.clientRunning) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }
    return this.adminClient.getRoom(roomId);
  }

  public async checkIsUserInRoom({
    roomId,
    userAccessToken,
  }: {
    roomId: string;
    userAccessToken: string;
  }): Promise<boolean> {
    try {
      return await this.runMatrixCallOnUserClient(
        userAccessToken,
        async (client) => {
          const members = await client.getJoinedRoomMembers(roomId);
          const userId = client.getUserId();
          if (!userId) {
            throw new sdk.MatrixError({ error: 'User ID not found' });
          }
          return members.joined[userId] !== undefined;
        },
      );
    } catch (error) {
      Logger.error('Error checking user membership:', error);
      return false;
    }
  }
  async stop(): Promise<void> {
    try {
      if (this.adminClient) {
        cleanupClient(this.adminClient);
        this.adminClient = undefined;
      }

      // Reset initialization state
      this.isInitialized = false;
    } catch (error) {
      Logger.error('Error during stop:', error);
      throw error;
    }
  }
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    try {
      this.adminClient = await createOracleAdminClient();
      this.stateManager = new MatrixStateManager(this.adminClient);
      await this.initializeClient(this.adminClient);
      Logger.info('MatrixManager initialized');
      this.isInitialized = true;
    } catch (error) {
      Logger.error('Error during initialization:', error);
      throw new sdk.MatrixError({
        error:
          error instanceof Error
            ? error.message
            : 'unknown error happened during initialization',
      });
    }
  }

  public static generateRoomAliasFromName(roomName: string): string {
    return roomName.replace(/\s/g, '_');
  }

  public static generateRoomNameFromDidAndOracle(
    did: string,
    oracleName: string,
  ): string {
    const id = crypto
      .createHash('md5')
      .update(did + oracleName)
      .digest('hex');
    return `ixo-${id}`;
  }

  private async createRoomWithConfig(
    options: IRoomCreationOptions,
  ): Promise<string> {
    if (!this.adminClient) {
      throw new sdk.MatrixError({ error: 'Admin client not initialized' });
    }

    const results = await this.adminClient.createRoom({
      name: options.name,
      room_alias_name: options.alias,
      topic: options.name,
      visibility: sdk.Visibility.Private,
      power_level_content_override: this.getRoomPowerLevels(
        options.adminUserId,
      ),
      initial_state: this.getInitialRoomState(),
      invite: [options.inviteUserId],
    });

    return results.room_id;
  }

  private getRoomPowerLevels(
    adminUserId: string,
  ): sdk.StateEvents['m.room.power_levels'] {
    return {
      kick: ADMIN_POWER_LEVEL,
      ban: ADMIN_POWER_LEVEL,
      invite: ADMIN_POWER_LEVEL,
      redact: ADMIN_POWER_LEVEL,
      users: {
        [adminUserId]: ADMIN_POWER_LEVEL,
      },
    };
  }

  private getInitialRoomState(): sdk.ICreateRoomStateEvent[] {
    return [
      {
        type: sdk.EventType.RoomEncryption,
        state_key: '',
        content: {
          algorithm: 'm.megolm.v1.aes-sha2',
        },
      } as sdk.ICreateRoomStateEvent,
      {
        type: sdk.EventType.RoomGuestAccess,
        state_key: '',
        content: {
          guest_access: sdk.GuestAccess.Forbidden,
        } satisfies sdk.StateEvents['m.room.guest_access'],
      } as sdk.ICreateRoomStateEvent,
      {
        type: sdk.EventType.RoomHistoryVisibility,
        state_key: '',
        content: {
          history_visibility: sdk.HistoryVisibility.Shared,
        } satisfies sdk.StateEvents['m.room.history_visibility'],
      } as sdk.ICreateRoomStateEvent,
    ];
  }

  async createRoomAndJoin(options: ICreateRoomAndJoinOptions): Promise<string> {
    try {
      if (!this.isInitialized || !this.adminClient) {
        throw new sdk.MatrixError({
          error: 'MatrixManager not initialized',
        });
      }

      const adminUserId = this.adminClient.getUserId();
      if (!adminUserId) {
        throw new sdk.MatrixError({ error: 'Admin user ID not found' });
      }

      const res = await this.runMatrixCallOnUserClient(
        options.userAccessToken,
        async (client) => {
          const userId = client.getUserId();
          if (!userId) {
            throw new sdk.MatrixError({ error: 'User ID not found' });
          }

          const roomName = MatrixManager.generateRoomNameFromDidAndOracle(
            options.did,
            options.oracleName,
          );
          const alias = MatrixManager.generateRoomAliasFromName(roomName);

          const roomId = await this.createRoomWithConfig({
            name: roomName,
            alias,
            adminUserId,
            inviteUserId: userId,
          });
          await client.joinRoom(roomId);
          return roomId;
        },
      );
      return res;
    } catch (error) {
      Logger.error('Error creating room:', error);
      throw error;
    }
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
                event_id: options.threadId,
              },
            }
          : undefined,
      });
    } catch (error) {
      Logger.error('Error sending message:', error);
      throw error;
    }
  }

  async sendActionLog(
    roomId: string,
    action: string,
    threadId?: string,
  ): Promise<sdk.ISendEventResponse> {
    return this.sendMessage({
      roomId,
      message: `The Oracle has performed the following action: ${action}`,
      threadId,
      isOracleAdmin: true,
    });
  }

  private async runMatrixCallOnUserClient<T>(
    accessToken: string,
    fn: (client: sdk.MatrixClient) => Promise<T>,
  ): Promise<T> {
    const loginResponse = await this.getLoginResponse(accessToken);
    const client = await this.createAuthenticatedClient(loginResponse);

    try {
      return await fn(client);
    } catch (error) {
      Logger.error('Error running matrix call on user client:', error);
      throw error;
    } finally {
      cleanupClient(client);
    }
  }

  private async getLoginResponse(
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

  private async createAuthenticatedClient(
    loginResponse: sdk.LoginResponse,
  ): Promise<sdk.MatrixClient> {
    return createMatrixClient({
      baseUrl: process.env.MATRIX_BASE_URL ?? '',
      accessToken: loginResponse.access_token,
      userId: loginResponse.user_id,
      deviceId: loginResponse.device_id,
    });
  }

  private async initializeClient(client: sdk.MatrixClient): Promise<void> {
    if (client.clientRunning) {
      return;
    }

    await this.setupClientCrypto(client);
    await this.startClientWithConfig(client);
    await this.setupCrossSigning(client);
    await this.finalizeClientSetup(client);
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
}

function cleanupClient(client: sdk.MatrixClient): void {
  Logger.info('🚀 ~ cleanupClient ~ client:', client.credentials);

  // Stop all ongoing syncs
  client.stopClient();

  // Remove all listeners
  client.removeAllListeners();

  // Close any open connections
  client.http.abort();
}
