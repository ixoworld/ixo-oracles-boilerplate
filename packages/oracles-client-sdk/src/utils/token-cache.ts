import { type IOpenIDToken } from 'matrix-js-sdk';

interface CachedTokenData {
  token: IOpenIDToken;
  expiresAt: number; // timestamp in milliseconds
  did: string;
}

const STORAGE_KEY_PREFIX = 'oracles_openid_token_';
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Generate a deterministic encryption key from the DID
 * This ensures the same DID always generates the same key
 */
async function generateKeyFromDid(
  did: string,
  matrixAccessToken: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const data = encoder.encode(did);

  // Use PBKDF2 to derive a key from the DID
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    data,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(matrixAccessToken), // Fixed salt for consistency
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt and store OpenID token in localStorage
 */
export async function encryptAndStore({
  token,
  matrixAccessToken,
  did,
}: {
  token: IOpenIDToken;
  matrixAccessToken: string;
  did: string;
}): Promise<void> {
  try {
    const key = await generateKeyFromDid(did, matrixAccessToken);

    // Calculate expiration time (token.expires_in is in seconds)
    const expiresAt = Date.now() + (token.expires_in || 3600) * 1000;

    const dataToEncrypt: CachedTokenData = {
      token,
      expiresAt,
      did,
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(dataToEncrypt));

    // Generate random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: iv,
      },
      key,
      data,
    );

    // Store IV + encrypted data as base64
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);

    const storageKey = `${STORAGE_KEY_PREFIX}${did}`;
    localStorage.setItem(storageKey, btoa(String.fromCharCode(...combined)));
  } catch (error) {
    console.error('Failed to encrypt and store token:', error);
    // Don't throw - caching is optional
  }
}

/**
 * Retrieve and decrypt OpenID token from localStorage
 */
export async function decryptAndRetrieve({
  did,
  matrixAccessToken,
}: {
  did: string;
  matrixAccessToken: string;
}): Promise<IOpenIDToken | null> {
  try {
    const storageKey = `${STORAGE_KEY_PREFIX}${did}`;
    const encryptedBase64 = localStorage.getItem(storageKey);

    if (!encryptedBase64) {
      return null;
    }

    const key = await generateKeyFromDid(did, matrixAccessToken);

    // Decode base64 and extract IV + encrypted data
    const combined = new Uint8Array(
      atob(encryptedBase64)
        .split('')
        .map((char) => char.charCodeAt(0)),
    );

    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    const decryptedData = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: iv,
      },
      key,
      encryptedData,
    );

    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedData);
    const cachedData: CachedTokenData = JSON.parse(jsonString);

    // Check if token is expired
    if (isTokenExpired(cachedData)) {
      // Clean up expired token
      localStorage.removeItem(storageKey);
      return null;
    }

    return cachedData.token;
  } catch (error) {
    console.error('Failed to decrypt token:', error);
    // Clean up corrupted data
    const storageKey = `${STORAGE_KEY_PREFIX}${did}`;
    localStorage.removeItem(storageKey);
    return null;
  }
}

/**
 * Check if cached token data is expired
 */
export function isTokenExpired(cachedData: CachedTokenData): boolean {
  return cachedData.expiresAt < Date.now();
}

/**
 * Clear cached token for a specific DID
 */
export function clearTokenCache(did: string): void {
  const storageKey = `${STORAGE_KEY_PREFIX}${did}`;
  localStorage.removeItem(storageKey);
}
