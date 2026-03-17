/**
 * Simple AES-256-GCM encryption for caching user tokens at rest.
 *
 * Uses MATRIX_VALUE_PIN (via scrypt) as the encryption key.
 * Produces a compact string: `salt:iv:authTag:ciphertext` (all hex).
 *
 * This is a temporary measure until UCAN-based auth is in place.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Derive a 32-byte key from the pin and a per-encryption salt. */
function deriveKey(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, KEY_LENGTH);
}

/** Encrypt a plaintext string. Returns `salt:iv:authTag:ciphertext` (hex). */
export function encryptToken(plaintext: string, pin: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(pin, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a string produced by `encryptToken`. */
export function decryptToken(encrypted: string, pin: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted token format');
  }

  const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
  if (!saltHex || !ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted token format');
  }

  const salt = Buffer.from(saltHex, 'hex');
  const key = deriveKey(pin, salt);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
