import { Logger } from '@ixo/logger';
import type * as sdk from 'matrix-js-sdk';
import { type ImportRoomKeyProgressData } from 'matrix-js-sdk/lib/crypto-api';
import { deriveKey } from 'matrix-js-sdk/lib/crypto/key_passphrase';
import { type SecretStorageKeyDescriptionAesV1 } from 'matrix-js-sdk/lib/secret-storage';
import { sleep } from 'matrix-js-sdk/lib/utils';
import {
  clearSecretStorageKeys,
  deletePrivateKey,
  getPrivateKey,
  hasPrivateKey,
  storePrivateKey,
} from '../../utils/secret-storage-keys';

export class CrossSigningManager {
  private client: sdk.MatrixClient;
  private recoveryPhrase: string;

  /**
   * Creates an instance of CrossSigningManager.
   * @param client - The Matrix client instance
   * @param recoveryPhrase - The recovery phrase for secret storage
   */
  constructor(client: sdk.MatrixClient, recoveryPhrase: string) {
    this.client = client;
    this.recoveryPhrase = recoveryPhrase;
  }

  /**
   * Checks if cross-signing account data exists.
   * @returns True if cross-signing master key data exists
   */
  public hasCrossSigningAccountData(): boolean {
    const masterKeyData = this.client.getAccountData('m.cross_signing.master');
    Logger.info('hasCrossSigningAccountData', { masterKeyData });
    return Boolean(masterKeyData);
  }

  /**
   * Gets the crypto API from the Matrix client.
   * @returns The Matrix crypto API instance
   * @throws Error if crypto API is not found
   */
  private getCryptoApi(): sdk.CryptoApi {
    const cryptoApi = this.client.getCrypto();
    if (!cryptoApi) {
      throw new Error('Crypto API not found');
    }
    return cryptoApi;
  }

  /**
   * Sets up cross-signing for the current device.
   * @throws Error if setup fails or admin password is not found
   */
  public async setupCrossSigning(): Promise<void> {
    clearSecretStorageKeys();
    const cryptoApi = this.getCryptoApi();

    // Create recovery key
    const recoveryKey = await cryptoApi.createRecoveryKeyFromPassphrase(
      this.recoveryPhrase,
    );
    Logger.info('Recovery key created', { recoveryKey });

    // Setup secret storage first
    await cryptoApi.bootstrapSecretStorage({
      createSecretStorageKey: async () => recoveryKey,
      setupNewSecretStorage: false,
      setupNewKeyBackup: false,

    });
    Logger.info('Secret storage bootstrapped');

    // Then setup cross-signing
    if (!process.env.MATRIX_ORACLE_ADMIN_PASSWORD) {
      throw new Error('Oracle admin password not found');
    }

    await cryptoApi.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest) => {
        await makeRequest({
          type: 'm.login.password',
          password: process.env.MATRIX_ORACLE_ADMIN_PASSWORD,
          identifier: {
            type: 'm.id.user',
            user: this.client.getUserId() ?? '',
          },
        });
      },
      setupNewCrossSigning: true,
    });
    // Create the key backup
    await cryptoApi.resetKeyBackup();
  }

  /**
   * Restores backup using secret storage.
   * @param keyData - Optional key data for backup restoration
   */
  public async restoreBackup(keyData?: {
    keyId: string;
    key?: string;
    phrase?: string;
    privateKey: Uint8Array;
  }): Promise<void> {
    const progressCallback = (progress: ImportRoomKeyProgressData): void => {
      Logger.info('restoreBackup', { progress });
      if (!progress.successes) {
        Logger.error('Failed to restore backup keys');
        return;
      }
      Logger.info(
        `Restoring backup keys... (${progress.successes}/${progress.total})`,
      );
    };

    try {
      const backupInfo = await this.client.getKeyBackupVersion();
      Logger.info('backupInfo', { backupInfo });
      if (!backupInfo) {
        Logger.error('No backup info found');
        return;
      }
      const info = await this.client.restoreKeyBackupWithSecretStorage(
        backupInfo,
        undefined,
        undefined,
        { progressCallback },
      );
      Logger.info(
        `Successfully restored backup keys (${info.imported}/${info.total}).`,
      );
    } catch (error) {
      const e = error as sdk.MatrixError;
      Logger.error('restoreBackup', error);
      if (e.errcode === 'RESTORE_BACKUP_ERROR_BAD_KEY') {
        if (keyData) {
          Logger.info(`Deleting private key for ${keyData.keyId}`);
          deletePrivateKey(keyData.keyId);
        }
        Logger.error('[BAD_KEY] Failed to restore backup. Key is invalid!');
      } else {
        Logger.error(`[UNKNOWN] Failed to restore backup. ${e.errcode}`, error);
      }
    }
  }

  /**
   * Gets the default secret storage key.
   * @returns The default key or undefined if not found
   */
  private getDefaultSSKey(): string | undefined {
    try {
      const accountData = this.client.getAccountData(
        'm.secret_storage.default_key',
      );
      const content = accountData?.getContent();
      return content?.key as string;
    } catch {
      Logger.error('Failed to get default SS key');
      return undefined;
    }
  }

  /**
   * Gets secret storage key information.
   * @param key - The key to get information for
   * @returns The key description or undefined if not found
   */
  private getSSKeyInfo(
    key: string,
  ): SecretStorageKeyDescriptionAesV1 | undefined {
    try {
      const accountData = this.client.getAccountData(
        `m.secret_storage.key.${key}`,
      );
      return accountData?.getContent();
    } catch {
      return undefined;
    }
  }

  /**
   * Accesses secret storage using the recovery phrase.
   * @returns Key data if successful, undefined otherwise
   */
  public async accessSecretStorage(): Promise<
    | {
        keyId: string;
        key?: string;
        phrase?: string;
        privateKey: Uint8Array;
      }
    | undefined
  > {
    const defaultSSKey = this.getDefaultSSKey();
    if (!defaultSSKey) {
      Logger.error('No default secret storage key found');
      return undefined;
    }

    if (hasPrivateKey(defaultSSKey)) {
      const privateKey = getPrivateKey(defaultSSKey);
      if (!privateKey) {
        Logger.error('Private key not found in storage');
        return undefined;
      }
      return {
        keyId: defaultSSKey,
        privateKey,
      };
    }

    const sSKeyInfo = this.getSSKeyInfo(defaultSSKey);
    if (!sSKeyInfo?.passphrase) {
      Logger.error('No passphrase info found in secret storage');
      return undefined;
    }

    try {
      const { salt, iterations } = sSKeyInfo.passphrase;
      const privateKey = await deriveKey(this.recoveryPhrase, salt, iterations);

      const isCorrect = await this.client.secretStorage.checkKey(
        privateKey,
        sSKeyInfo,
      );

      if (!isCorrect) {
        Logger.error('Incorrect recovery phrase');
        return undefined;
      }

      storePrivateKey(defaultSSKey, privateKey);
      return {
        keyId: defaultSSKey,
        phrase: this.recoveryPhrase,
        privateKey,
      };
    } catch (error) {
      Logger.error('Error accessing secret storage:', error);
      return undefined;
    }
  }

  /**
   * Checks if the current device is cross-signed.
   * @returns True if device is cross-signed
   */
  public async isCrossVerified(): Promise<boolean> {
    try {
      const userId = this.client.getUserId();
      if (!userId) {
        throw new Error('User ID not found');
      }

      const cryptoApi = this.getCryptoApi();
      const cryptoStatus = await cryptoApi.getUserVerificationStatus(userId);
      const deviceStatus = await cryptoApi.getDeviceVerificationStatus(
        userId,
        this.client.getDeviceId() ?? '',
      );
      const isVerified = cryptoStatus.isCrossSigningVerified();
      Logger.info('Cross-signing verification status:', {
        userId,
        isVerified,
        crossSigningStatus: cryptoStatus,
        verified: cryptoStatus.isVerified(),
        deviceStatus,
      });

      return isVerified;
    } catch (error) {
      Logger.error('Error checking cross-signing verification:', error);
      return false;
    }
  }

  /**
   * Verifies the current device using secret storage.
   * @throws Error if verification fails
   */
  public async verifyDevice(): Promise<void> {
    try {
      const keyData = await this.accessSecretStorage();
      Logger.info('verifyDevice::keyData', { keyData });
      if (!keyData) {
        return;
      }

      await this.client.checkOwnCrossSigningTrust();
    } catch (error) {
      Logger.error('ERROR::verifyDevice', error);
      throw error;
    }
  }

  /**
   * Ensures cross-signing is set up and the device is verified.
   * Handles initial setup, backup restoration, and verification with retries.
   * @throws Error if setup or verification fails after multiple attempts
   */
  public async ensureCrossSigningIsSetup(): Promise<void> {
    let isCSEnabled = this.hasCrossSigningAccountData();

    if (!isCSEnabled) {
      Logger.info('Setting up cross-signing');
      await this.setupCrossSigning();
      isCSEnabled = this.hasCrossSigningAccountData();
      if (!isCSEnabled) {
        throw new Error('Cross-signing setup failed');
      }
    } else {
      Logger.info('Cross-signing already enabled');
      let keyData = await this.accessSecretStorage();
      Logger.info(`keyData:`, { keyData });
      if (keyData) {
        Logger.info('Restoring backup with recovery phrase');
        await this.restoreBackup(keyData);
      }
      keyData = await this.accessSecretStorage();

      if (!keyData) {
        throw new Error('Failed to restore backup with recovery phrase');
      }
    }

    let isDeviceCrossVerified = await this.isCrossVerified();

    if (!isDeviceCrossVerified) {
      // First try manual verification
      await this.verifyDevice();
      await sleep(1000); // Give some time for verification to propagate

      // Then retry with exponential backoff
      for (let attempts = 0; attempts < 5; attempts++) {
        Logger.info(`Verification attempt ${attempts + 1}`);
        // eslint-disable-next-line no-await-in-loop -- for loop
        isDeviceCrossVerified = await this.isCrossVerified();
        if (isDeviceCrossVerified) {
          break;
        }
        // eslint-disable-next-line no-await-in-loop -- for loop
        await sleep(Math.pow(2, attempts) * 1000); // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      }

      if (!isDeviceCrossVerified) {
        throw new Error('Device verification failed after multiple attempts');
      }
    }
  }
}
