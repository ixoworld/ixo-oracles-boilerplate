/**
 * SSSS (Secret Storage) Utilities
 *
 * Extracts the key backup decryption key from Matrix Secret Storage
 * using the oracle's recovery phrase (MATRIX_RECOVERY_PHRASE).
 *
 * This allows the bot-sdk to automatically restore keys from backup
 * without needing to store the backup key separately.
 *
 * Crypto operations follow the Matrix spec:
 * - PBKDF2-SHA512 for passphrase → SSSS key derivation
 * - HKDF-SHA256 for SSSS key → AES + HMAC key derivation
 * - AES-CTR for decryption, HMAC-SHA256 for verification
 */

import * as crypto from 'node:crypto';
import { Logger } from '@ixo/logger';

// Interfaces matching Matrix spec account_data event formats

interface SSSSKeyPassphraseInfo {
  algorithm: string; // "m.pbkdf2"
  iterations: number;
  salt: string;
  bits?: number; // default 256
}

interface SSSSKeyInfo {
  name?: string;
  algorithm: string; // "m.secret_storage.v1.aes-hmac-sha2"
  iv?: string;
  mac?: string;
  passphrase?: SSSSKeyPassphraseInfo;
}

interface SSSSEncryptedData {
  iv: string;
  ciphertext: string;
  mac: string;
}

interface SSSSSecretData {
  encrypted: Record<string, SSSSEncryptedData>;
}

/**
 * Fetch account data from the Matrix homeserver.
 */
async function getAccountData(
  baseUrl: string,
  accessToken: string,
  userId: string,
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const url = `${baseUrl}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch account data ${type}: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Derive the SSSS master key from a passphrase using PBKDF2-SHA512.
 */
async function deriveSSSSKeyFromPassphrase(
  passphrase: string,
  salt: string,
  iterations: number,
  bits: number = 256,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations,
      hash: 'SHA-512',
    },
    key,
    bits,
  );

  return new Uint8Array(keyBits);
}

/**
 * Derive AES and HMAC keys from the SSSS master key using HKDF-SHA256.
 */
async function deriveKeys(masterKey: Uint8Array, secretName: string) {
  const zeroSalt = new Uint8Array(8);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    masterKey,
    { name: 'HKDF' },
    false,
    ['deriveBits'],
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      salt: zeroSalt,
      info: new TextEncoder().encode(secretName),
      hash: 'SHA-256',
    },
    hkdfKey,
    512,
  );

  const aesKeyData = keyBits.slice(0, 32);
  const hmacKeyData = keyBits.slice(32);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    aesKeyData,
    { name: 'AES-CTR' },
    false,
    ['encrypt', 'decrypt'],
  );

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    hmacKeyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign', 'verify'],
  );

  return [aesKey, hmacKey] as const;
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Encrypt a value using SSSS (for key verification).
 */
async function encryptAESSecretStorageItem(
  data: string,
  masterKey: Uint8Array,
  secretName: string,
  providedIv?: string,
): Promise<{ iv: string; ciphertext: string; mac: string }> {
  const [aesKey, hmacKey] = await deriveKeys(masterKey, secretName);

  let iv: Uint8Array;
  if (providedIv) {
    iv = decodeBase64(providedIv);
  } else {
    iv = new Uint8Array(crypto.randomBytes(16));
    iv[8]! &= 0x7f;
  }

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CTR', counter: iv, length: 64 },
      aesKey,
      new TextEncoder().encode(data),
    ),
  );

  const mac = new Uint8Array(
    await crypto.subtle.sign({ name: 'HMAC' }, hmacKey, ciphertext),
  );

  return {
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
    mac: encodeBase64(mac),
  };
}

/**
 * Decrypt an SSSS-encrypted secret.
 */
async function decryptSSSSSecret(
  encryptedData: SSSSEncryptedData,
  masterKey: Uint8Array,
  secretName: string,
): Promise<string> {
  const [aesKey, hmacKey] = await deriveKeys(masterKey, secretName);

  const ciphertext = decodeBase64(encryptedData.ciphertext);
  const mac = decodeBase64(encryptedData.mac);
  const iv = decodeBase64(encryptedData.iv);

  const isValid = await crypto.subtle.verify(
    { name: 'HMAC' },
    hmacKey,
    mac,
    ciphertext,
  );

  if (!isValid) {
    throw new Error(
      `SSSS decryption failed for "${secretName}": bad MAC (wrong passphrase?)`,
    );
  }

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: iv, length: 64 },
    aesKey,
    ciphertext,
  );

  return new TextDecoder().decode(new Uint8Array(plaintext));
}

/**
 * Verify that an SSSS key matches the stored key check MAC.
 */
async function verifySSSSKey(
  masterKey: Uint8Array,
  keyInfo: SSSSKeyInfo,
): Promise<boolean> {
  if (!keyInfo.iv || !keyInfo.mac) {
    return true;
  }

  const zeroString = '\0'.repeat(32);
  const check = await encryptAESSecretStorageItem(
    zeroString,
    masterKey,
    '',
    keyInfo.iv,
  );

  const expected = keyInfo.mac.replace(/=+$/, '');
  const actual = check.mac.replace(/=+$/, '');
  return expected === actual;
}

/**
 * Extract the key backup decryption key from SSSS.
 *
 * Uses the oracle's recovery phrase to derive the SSSS master key,
 * then decrypts the backup key stored in account_data.
 *
 * @returns Base64-encoded backup decryption key, or null if not available
 */
export async function extractBackupKeyFromSSS({
  baseUrl,
  accessToken,
  userId,
  recoveryPhrase,
}: {
  baseUrl: string;
  accessToken: string;
  userId: string;
  recoveryPhrase: string;
}): Promise<string | null> {
  // 1. Get default SSSS key ID
  const defaultKeyData = await getAccountData(
    baseUrl,
    accessToken,
    userId,
    'm.secret_storage.default_key',
  );
  if (!defaultKeyData || !defaultKeyData.key) {
    Logger.debug('SSSS not set up (no default key)');
    return null;
  }
  const keyId: string = defaultKeyData.key;

  // 2. Get SSSS key metadata
  const keyInfo: SSSSKeyInfo | null = await getAccountData(
    baseUrl,
    accessToken,
    userId,
    `m.secret_storage.key.${keyId}`,
  );
  if (!keyInfo) {
    Logger.warn(`SSSS key metadata not found for key ID: ${keyId}`);
    return null;
  }

  if (keyInfo.algorithm !== 'm.secret_storage.v1.aes-hmac-sha2') {
    Logger.warn(`Unsupported SSSS algorithm: ${keyInfo.algorithm}`);
    return null;
  }

  if (!keyInfo.passphrase || keyInfo.passphrase.algorithm !== 'm.pbkdf2') {
    Logger.warn(
      'SSSS key is not passphrase-based, cannot derive from recovery phrase',
    );
    return null;
  }

  // 3. Derive SSSS master key from passphrase
  Logger.debug('Deriving SSSS key from recovery phrase (PBKDF2)...');
  const masterKey = await deriveSSSSKeyFromPassphrase(
    recoveryPhrase,
    keyInfo.passphrase.salt,
    keyInfo.passphrase.iterations,
    keyInfo.passphrase.bits || 256,
  );

  // 4. Verify key
  const keyValid = await verifySSSSKey(masterKey, keyInfo);
  if (!keyValid) {
    throw new Error(
      'SSSS key verification failed: recovery phrase does not match',
    );
  }

  // 5. Fetch encrypted backup key
  const backupSecret: SSSSSecretData | null = await getAccountData(
    baseUrl,
    accessToken,
    userId,
    'm.megolm_backup.v1',
  );
  if (
    !backupSecret ||
    !backupSecret.encrypted ||
    !backupSecret.encrypted[keyId]
  ) {
    Logger.debug('No backup key found in SSSS');
    return null;
  }

  // 6. Decrypt
  const backupKeyBase64 = await decryptSSSSSecret(
    backupSecret.encrypted[keyId],
    masterKey,
    'm.megolm_backup.v1',
  );

  return backupKeyBase64;
}
