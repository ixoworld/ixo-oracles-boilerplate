/**
 * Simple AES-256-GCM encryption for caching user tokens at rest.
 *
 * Uses MATRIX_VALUE_PIN (via scrypt) as the encryption key.
 * Produces a compact string: `iv:authTag:ciphertext` (all hex).
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
const SALT = 'ixo-task-token-cache'; // static salt is fine — pin is high-entropy

/** Derive a 32-byte key from the pin (cached per pin value). */
let _cachedKey: { pin: string; key: Buffer } | null = null;

function deriveKey(pin: string): Buffer {
  if (_cachedKey && _cachedKey.pin === pin) return _cachedKey.key;
  const key = scryptSync(pin, SALT, KEY_LENGTH);
  _cachedKey = { pin, key };
  return key;
}

/** Encrypt a plaintext string. Returns `iv:authTag:ciphertext` (hex). */
export function encryptToken(plaintext: string, pin: string): string {
  const key = deriveKey(pin);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a string produced by `encryptToken`. */
export function decryptToken(encrypted: string, pin: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted token format');
  }

  const key = deriveKey(pin);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
