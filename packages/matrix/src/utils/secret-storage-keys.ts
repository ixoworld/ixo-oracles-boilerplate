import { Logger } from '@ixo/logger';

import { LocalJsonStorage } from '../local-storage/local-storage';

const secretStorageKeys = new LocalJsonStorage(
   process.env.MATRIX_SECRET_STORAGE_KEYS_PATH ||'./matrix-secret-storage-keys-new2',
);

export function storePrivateKey(keyId: string, privateKey: Uint8Array): void {
  if (!(privateKey instanceof Uint8Array)) {
    throw new Error('Unable to store, privateKey is invalid.');
  }

  Logger.info(`Storing private key for ${keyId}`);
  secretStorageKeys.setItem(keyId, privateKey);
}

export function hasPrivateKey(keyId: string): boolean {
  return secretStorageKeys.getItem(keyId) instanceof Uint8Array;
}

export function getPrivateKey(keyId: string): Uint8Array | undefined {
  const deserializedArray = secretStorageKeys.getItem<Uint8Array>(keyId);
  Logger.info(`Getting private key for ${keyId}`, {
    secretStorageKeys: deserializedArray,
  });

  return deserializedArray;
}

export function deletePrivateKey(keyId: string): void {
  Logger.info(`Deleting private key for ${keyId}`);
  secretStorageKeys.removeItem(keyId);
}

export function clearSecretStorageKeys(): void {
  Logger.info(`Clearing secret storage keys`);
  secretStorageKeys.clear();
}

export async function getSecretStorageKey({
  keys,
}: {
  keys: Record<string, unknown>;
}): Promise<[string, Uint8Array] | null> {
  const keyIds = Object.keys(keys);
  Logger.info(`Getting secret storage key for`, keyIds);
  const keyId = keyIds.find(hasPrivateKey);
  if (!keyId) {
    return null;
  }

  const privateKey = getPrivateKey(keyId);
  if (!privateKey) {
    return null;
  }

  return [keyId, privateKey];
}

export function cacheSecretStorageKey(
  keyId: string,
  _keyInfo: unknown,
  privateKey: Uint8Array,
): void {
  Logger.info(`Caching secret storage key for ${keyId}`);
  secretStorageKeys.setItem(keyId, privateKey);
}
