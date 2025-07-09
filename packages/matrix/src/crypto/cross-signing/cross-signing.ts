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
   * Checks if cross-signing setup is needed.
   * @returns True if cross-signing setup is required
   */
  public async needsCrossSigningSetup(): Promise<boolean> {
    try {
      // Check if cross-signing is enabled
      if (!this.hasCrossSigningAccountData()) {
        return true;
      }

      // Check if we can access secret storage
      const keyData = await this.accessSecretStorage();
      if (!keyData) {
        return true;
      }

      // Check if device is verified
      const isVerified = await this.isCrossVerified();
      return !isVerified;
    } catch (error) {
      Logger.warn('Error checking cross-signing setup requirements:', error);
      return true; // Assume setup is needed if we can't determine status
    }
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
    const cryptoApi = this.getCryptoApi();

    // Only clear keys if we're doing a fresh setup
    try {
      // Check if we already have valid secret storage
      const defaultKey = this.getDefaultSSKey();
      if (defaultKey && !hasPrivateKey(defaultKey)) {
        // We have a key but no private key - this might be a recovery scenario
        Logger.info(
          'Existing secret storage found but no private key - clearing to start fresh',
        );
        clearSecretStorageKeys();
      }
    } catch (error) {
      Logger.warn(
        'Error checking existing secret storage, proceeding with fresh setup:',
        error,
      );
      clearSecretStorageKeys();
    }

    // Create recovery key
    const recoveryKey = await cryptoApi.createRecoveryKeyFromPassphrase(
      this.recoveryPhrase,
    );
    Logger.info('Recovery key created', { recoveryKey });

    // Setup secret storage first
    // For initial setup, we need to create new secret storage and key backup
    await cryptoApi.bootstrapSecretStorage({
      createSecretStorageKey: async () => recoveryKey,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
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
    Logger.info('Cross-signing bootstrapped');
  }

  /**
   * Restores backup using secret storage.
   * @param keyData - Optional key data for backup restoration
   * @throws Error with specific details about restoration failure
   */
  public async restoreBackup(keyData?: {
    keyId: string;
    key?: string;
    phrase?: string;
    privateKey: Uint8Array;
  }): Promise<void> {
    const progressCallback = (progress: ImportRoomKeyProgressData): void => {
      Logger.info('restoreBackup progress', { progress });
      if ((progress.successes ?? 0) === 0 && (progress.failures ?? 0) > 0) {
        Logger.warn('Some backup keys failed to restore');
      }
      if ((progress.successes ?? 0) > 0) {
        Logger.info(
          `Restoring backup keys... (${progress.successes ?? 0}/${progress.total})`,
        );
      }
    };

    try {
      const backupInfo = await this.client.getKeyBackupVersion();
      Logger.info('Backup info retrieved', { backupInfo });

      if (!backupInfo) {
        Logger.warn(
          'No backup info found - this may be expected for new devices',
        );
        return;
      }

      const info = await this.client.restoreKeyBackupWithSecretStorage(
        backupInfo,
        undefined,
        undefined,
        { progressCallback },
      );

      Logger.info(
        `Successfully restored backup keys (${info.imported}/${info.total})`,
        {
          imported: info.imported,
          total: info.total,
          backupVersion: backupInfo.version,
        },
      );

      if (info.imported === 0 && info.total > 0) {
        Logger.warn('No keys were imported despite backup existing');
      }
    } catch (error) {
      const e = error as sdk.MatrixError;
      Logger.error('Backup restoration failed', {
        error: e.message,
        errcode: e.errcode,
      });

      if (e.errcode === 'RESTORE_BACKUP_ERROR_BAD_KEY') {
        if (keyData) {
          Logger.info(`Deleting corrupted private key for ${keyData.keyId}`);
          deletePrivateKey(keyData.keyId);
        }
        throw new Error(
          'Backup restoration failed: Invalid key. The recovery phrase may be incorrect.',
        );
      } else if (e.errcode === 'M_NOT_FOUND') {
        Logger.warn(
          'Backup not found on server - this may be expected for new setups',
        );
      } else if (e.errcode === 'M_FORBIDDEN') {
        throw new Error(
          'Backup restoration failed: Access denied. Check user permissions.',
        );
      } else {
        throw new Error(
          `Backup restoration failed: ${e.errcode || 'Unknown error'}`,
        );
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
    try {
      // Step 1: Check if cross-signing is already set up
      let isCSEnabled = this.hasCrossSigningAccountData();

      if (!isCSEnabled) {
        Logger.info('Cross-signing not found, setting up...');
        await this.setupCrossSigning();

        // Verify setup was successful
        isCSEnabled = this.hasCrossSigningAccountData();
        if (!isCSEnabled) {
          throw new Error(
            'Cross-signing setup failed - no account data found after setup',
          );
        }
        Logger.info('Cross-signing setup completed successfully');
      } else {
        Logger.info(
          'Cross-signing already enabled, checking secret storage access...',
        );

        // Try to access secret storage
        let keyData = await this.accessSecretStorage();

        if (!keyData) {
          Logger.error(
            'Cannot access secret storage with current recovery phrase',
          );
          throw new Error(
            'Failed to access secret storage - recovery phrase may be incorrect',
          );
        }

        Logger.info(
          'Secret storage access confirmed, attempting backup restoration...',
        );

        // Attempt to restore backup
        try {
          await this.restoreBackup(keyData);
          Logger.info('Backup restoration completed');
        } catch (error) {
          Logger.warn(
            'Backup restoration failed, continuing with verification:',
            error,
          );
          // Don't throw here - backup restoration failure isn't always fatal
        }

        // Re-verify secret storage access after backup restoration
        keyData = await this.accessSecretStorage();
        if (!keyData) {
          throw new Error(
            'Secret storage access lost after backup restoration',
          );
        }
      }

      // Step 2: Verify device cross-signing status
      await this.ensureDeviceIsVerified();

      Logger.info(
        'Cross-signing setup and verification completed successfully',
      );
    } catch (error) {
      Logger.error('Failed to ensure cross-signing setup:', error);
      throw error;
    }
  }

  /**
   * Ensures the current device is verified with exponential backoff retry logic.
   * @throws Error if verification fails after multiple attempts
   */
  private async ensureDeviceIsVerified(): Promise<void> {
    let isDeviceCrossVerified = await this.isCrossVerified();

    if (isDeviceCrossVerified) {
      Logger.info('Device is already cross-verified');
      return;
    }

    Logger.info('Device is not cross-verified, attempting verification...');

    // First attempt: try manual verification
    try {
      await this.verifyDevice();
      await sleep(1000); // Give some time for verification to propagate
    } catch (error) {
      Logger.warn('Manual verification attempt failed:', error);
      // Continue with retry logic
    }

    // Retry with exponential backoff
    const maxAttempts = 5;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      Logger.info(`Verification check attempt ${attempts + 1}/${maxAttempts}`);

      isDeviceCrossVerified = await this.isCrossVerified();
      if (isDeviceCrossVerified) {
        Logger.info(
          `Device verification succeeded after ${attempts + 1} attempts`,
        );
        return;
      }

      if (attempts < maxAttempts - 1) {
        const sleepTime = Math.pow(2, attempts) * 1000; // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        Logger.info(`Waiting ${sleepTime}ms before next attempt...`);
        await sleep(sleepTime);
      }
    }

    throw new Error(`Device verification failed after ${maxAttempts} attempts`);
  }
}
