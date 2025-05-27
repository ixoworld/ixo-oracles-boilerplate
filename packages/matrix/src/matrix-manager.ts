import { Logger } from '@ixo/logger';
import olm from '@matrix-org/olm';
import * as sdk from 'matrix-js-sdk';
import {
  VerificationPhase,
  VerificationRequestEvent,
} from 'matrix-js-sdk/lib/crypto-api';
import { logger } from 'matrix-js-sdk/lib/logger';
import crypto from 'node:crypto';
import { MatrixStateManager } from './matrix-state-manager';
import {
  type ICreateRoomOptions,
  type IMessageOptions,
  type IRoomCreationOptions,
} from './types/matrix';
import createMatrixClient from './utils/create-matrix-client';
import { formatMsg } from './utils/format-msg';
import { syncMatrixState } from './utils/sync';

// Constants
const INITIAL_SYNC_LIMIT = 1;

// Configure global Olm and SDK logging level
global.Olm = olm;
logger.setLevel(logger.levels.ERROR);

// FinalizationRegistry fallback for orphaned managers
const matrixRegistry = new FinalizationRegistry<sdk.MatrixClient>((client) => {
  Logger.info('MatrixClient auto-cleaned by FinalizationRegistry');
  cleanupClient(client);
});

export class MatrixManager {
  public stateManager: MatrixStateManager;
  private readonly idleTimeoutMs: number;
  private idleTimeout?: NodeJS.Timeout;
  private destroyed = false;
  private readonly client: sdk.MatrixClient;

  /**
   * Private constructor: use createInstance()
   */
  private constructor(client: sdk.MatrixClient, idleTimeoutMs = 5 * 60_000) {
    this.client = client;
    this.idleTimeoutMs = idleTimeoutMs;
    this.stateManager = new MatrixStateManager(client);
    this.scheduleIdleCleanup();
  }

  /**
   * Factory to login, initialize, and register for GC cleanup
   */
  public static async createInstance(
    userAccessToken: string,
    idleTimeoutMs?: number,
  ): Promise<MatrixManager> {
    const loginResponse = await MatrixManager.getLoginResponse(userAccessToken);
    const client = createMatrixClient({
      baseUrl: process.env.MATRIX_BASE_URL ?? '',
      accessToken: userAccessToken,
      userId: loginResponse.user_id,
      deviceId: loginResponse.device_id,
      useAuthorizationHeader: true,
    });

    await MatrixManager.initializeClient(client);
    const manager = new MatrixManager(client, idleTimeoutMs);
    matrixRegistry.register(manager, client);
    return manager;
  }

  /**
   * Explicit teardown: idempotent, unregisters from GC registry
   */
  public killClient(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    matrixRegistry.unregister(this);
    this.clearIdleCleanup();
    Logger.info(`Killing MatrixClient for user ${this.client.getUserId()}`);
    cleanupClient(this.client);
  }

  /**
   * Guard for use-after-destroy & reset idle timer
   */
  private touch(): void {
    if (this.destroyed) {
      throw new Error('MatrixManager has been destroyed.');
    }
    this.scheduleIdleCleanup();
  }

  /**
   * Schedule the idle-timeout cleanup
   */
  private scheduleIdleCleanup(): void {
    const hadTimer = this.idleTimeout !== undefined;
    this.clearIdleCleanup();
    if (!hadTimer) {
      Logger.info(
        `Scheduling idle cleanup in ${this.idleTimeoutMs}ms for user ${this.client.getUserId()}`,
      );
    } else {
      Logger.debug(
        `Rescheduling idle cleanup in ${this.idleTimeoutMs}ms for user ${this.client.getUserId()}`,
      );
    }
    this.idleTimeout = setTimeout(() => {
      Logger.info(
        `Idle timeout reached (${this.idleTimeoutMs}ms) for user ${this.client.getUserId()}, tearing down`,
      );
      this.killClient();
    }, this.idleTimeoutMs);
  }

  /**
   * Clear pending idle-timeout
   */
  private clearIdleCleanup(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = undefined;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Public API methods: each begins with touch()
  // ─────────────────────────────────────────────────────────

  public async getRoomId({
    did,
    oracleName,
  }: {
    did: string;
    oracleName: string;
  }): Promise<string | undefined> {
    this.touch();
    const roomName = MatrixManager.generateRoomNameFromDidAndOracle(
      did,
      oracleName,
    );
    return this.getRoomIdFromAlias(
      MatrixManager.generateRoomAliasFromName(roomName),
    );
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public async getRoomIdFromAlias(
    roomAlias: string,
  ): Promise<string | undefined> {
    this.touch();
    try {
      const host = new URL(process.env.MATRIX_BASE_URL ?? '').host;
      const { room_id: roomId } = await this.client.getRoomIdForAlias(
        `#${roomAlias}:${host}`,
      );
      return roomId;
    } catch (error) {
      const err = error as sdk.MatrixError;
      if (err.errcode === 'M_INVALID_PARAM') throw err;
      return undefined;
    }
  }

  public getRoom(roomId: string): sdk.Room | null {
    this.touch();
    return this.client.getRoom(roomId);
  }

  public async checkIsUserInRoom({
    roomId,
    userId,
  }: {
    roomId: string;
    userId: string;
  }): Promise<boolean> {
    this.touch();
    try {
      const room = this.client.getRoom(roomId);
      if (!room) return false;
      return room.getJoinedMembers().some((m) => m.userId === userId);
    } catch (error) {
      Logger.error('Error checking user membership:', error);
      return false;
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

  public async createRoom(options: ICreateRoomOptions): Promise<string> {
    this.touch();
    try {
      const name = MatrixManager.generateRoomNameFromDidAndOracle(
        options.did,
        options.oracleName,
      );
      const alias = MatrixManager.generateRoomAliasFromName(name);
      return await this.createRoomWithConfig({ name, alias });
    } catch (error) {
      Logger.error('Error creating room:', error);
      throw error;
    }
  }

  private async createRoomWithConfig(
    options: IRoomCreationOptions,
  ): Promise<string> {
    this.touch();
    const userId = this.client.getUserId();
    if (!userId) throw new sdk.MatrixError({ error: 'User ID not found' });

    const roomResponse = await this.client.createRoom({
      name: options.name,
      room_alias_name: options.alias,
      topic: options.name,
      visibility: sdk.Visibility.Private,
      power_level_content_override: this.getRoomPowerLevels(userId),
      initial_state: this.getInitialRoomState(),
    });
    return roomResponse.room_id;
  }

  private getRoomPowerLevels(
    userId: string,
  ): sdk.StateEvents['m.room.power_levels'] {
    return {
      users: { [userId]: 999 },
      users_default: 0,
      invite: 999,
      kick: 999,
      ban: 999,
      redact: 999,
    };
  }

  private getInitialRoomState(): sdk.ICreateRoomStateEvent[] {
    return [
      {
        type: sdk.EventType.RoomEncryption,
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      } as sdk.ICreateRoomStateEvent,
      {
        type: sdk.EventType.RoomGuestAccess,
        state_key: '',
        content: { guest_access: sdk.GuestAccess.Forbidden },
      } as sdk.ICreateRoomStateEvent,
      {
        type: sdk.EventType.RoomHistoryVisibility,
        state_key: '',
        content: { history_visibility: sdk.HistoryVisibility.Shared },
      } as sdk.ICreateRoomStateEvent,
    ];
  }

  public async sendMessage(
    options: IMessageOptions,
  ): Promise<sdk.ISendEventResponse> {
    this.touch();
    try {
      return await this.client.sendMessage(options.roomId, {
        msgtype: sdk.MsgType.Text,
        body: formatMsg(options.message, Boolean(options.isOracleAdmin)),
        'm.relates_to': options.threadId
          ? { 'm.in_reply_to': { event_id: options.threadId } }
          : undefined,
      });
    } catch (error) {
      Logger.error('Error sending message:', error);
      throw error;
    }
  }

  public async requestUserVerification(): Promise<void> {
    const cryptoApi = this.client.getCrypto();
    if (!cryptoApi) throw new sdk.MatrixError({ error: 'Crypto not found' });
    // Listen for SAS display
    const req = await cryptoApi.requestOwnUserVerification();
    // Sends `m.key.verification.request` to the user’s other devices

    req.on(VerificationRequestEvent.Change, () => {
      (async () => {
        // Step 2: once the request is acknowledged, send the “start” event
        if (req.phase === VerificationPhase.Requested) {
          await req.startVerification('m.sas.v1');
        }

        // Step 3: when SAS is ready, display & confirm
        if (req.phase === VerificationPhase.Started && req.verifier) {
          const sas = req.verifier.getShowSasCallbacks();
          if (!sas) return;

          Logger.info(
            'SAS (emoji):',
            sas.sas.emoji?.map((e) => e[0]).join(' '),
          );
          Logger.info('SAS (decimal):', sas.sas.decimal?.join(' • '));

          await sas.confirm(); // sends the MAC
          await req.verifier.verify(); // waits for final DONE
          Logger.info('✅ Server device verified');
        }
      })().catch((err) => {
        Logger.error('Verification flow failed:', err);
      });
    });
  }

  public async sendActionLog(
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

  static async getLoginResponse(
    accessToken: string,
  ): Promise<sdk.LoginResponse> {
    const tempClient = sdk.createClient({
      baseUrl: process.env.MATRIX_BASE_URL ?? '',
      accessToken,
    });
    const resp = await tempClient.whoami();
    if (!resp.user_id || !resp.device_id)
      throw new sdk.MatrixError({ error: 'Invalid access token' });
    cleanupClient(tempClient);
    return {
      user_id: resp.user_id,
      access_token: accessToken,
      device_id: resp.device_id,
    };
  }

  static async initializeClient(client: sdk.MatrixClient): Promise<void> {
    if (client.clientRunning) return;
    await MatrixManager.setupClientCrypto(client);
    await MatrixManager.startClientWithConfig(client);
    await MatrixManager.finalizeClientSetup(client);
  }

  private static async setupClientCrypto(
    client: sdk.MatrixClient,
  ): Promise<void> {
    await client.initCrypto();
  }

  private static async startClientWithConfig(
    client: sdk.MatrixClient,
  ): Promise<void> {
    await client.startClient({
      lazyLoadMembers: false,
      initialSyncLimit: INITIAL_SYNC_LIMIT,
      includeArchivedRooms: false,
    });
    await syncMatrixState(client);
  }

  private static async finalizeClientSetup(
    client: sdk.MatrixClient,
  ): Promise<void> {
    const userId = client.getUserId();
    if (!userId) throw new sdk.MatrixError({ error: 'User ID not found' });
    const deviceId = client.getDeviceId();
    if (!deviceId) throw new sdk.MatrixError({ error: 'Device ID not found' });
    await client.setDeviceVerified(userId, deviceId, true);
    client.setGlobalErrorOnUnknownDevices(false);
  }
}

/**
 * Cleanup helper: stops sync, removes listeners, aborts HTTP
 */
function cleanupClient(client: sdk.MatrixClient): void {
  client.stopClient();
  client.removeAllListeners();
  client.http.abort();
}
