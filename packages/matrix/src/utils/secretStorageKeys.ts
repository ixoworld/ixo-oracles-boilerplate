import { Logger } from '@ixo/logger';

const secretStorageKeys = new Map();

export function storePrivateKey(keyId: string, privateKey: Uint8Array) {
  if (privateKey instanceof Uint8Array === false) {
    throw new Error('Unable to store, privateKey is invalid.');
  }

  secretStorageKeys.set(keyId, privateKey);
}

export function hasPrivateKey(keyId: string) {
  return secretStorageKeys.get(keyId) instanceof Uint8Array;
}

export function getPrivateKey(keyId: string) {
  return secretStorageKeys.get(keyId);
}

export function deletePrivateKey(keyId: string) {
  secretStorageKeys.delete(keyId);
}

export function clearSecretStorageKeys() {
  secretStorageKeys.clear();
}

export async function getSecretStorageKey({
  keys,
}: {
  keys: Record<string, unknown>;
}): Promise<[string, Uint8Array] | null> {
  const keyIds = Object.keys(keys);
  const keyId = keyIds.find(hasPrivateKey);
  Logger.info('[]          getSecretStorageKey', keys, keyIds, keyId);

  if (!keyId) {
    return null;
  }

  const privateKey = getPrivateKey(keyId);

  return [keyId, privateKey];
}

export function cacheSecretStorageKey(
  keyId: string,
  _keyInfo: unknown,
  privateKey: Uint8Array,
) {
  secretStorageKeys.set(keyId, privateKey);
}
