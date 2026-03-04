/**
 * Loads an existing P-256 encryption key from Matrix room state.
 *
 * Key generation and on-chain publishing is handled by the CLI
 * (oracles-cli setup-encryption-key), not at oracle runtime.
 * This module only reads and decrypts existing keys.
 */

import { Logger } from '@ixo/logger';
import { type JWK } from 'jose';

import { getMatrixHomeServerForDid } from './did-matrix-batcher.js';
import { decrypt } from './setup-claim-signing-mnemonics.js';

const STATE_EVENT_TYPE = 'ixo.room.encryption_key.index';
const STATE_KEY = 'p256_encryption';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EncryptionKeyEntry {
  eventId: string;
  didVerificationMethodId: string;
  algorithm: string;
  curve: string;
  createdAt: string;
  active: boolean;
}

interface EncryptionKeyIndexContent {
  keys: Record<string, EncryptionKeyEntry>;
}

export interface LoadEncryptionKeyParams {
  matrixRoomId: string;
  matrixAccessToken: string;
  pin: string;
  signerDid: string;
}

export interface EncryptionKeyResult {
  privateJwk: JWK;
  publicKeyId: string;
}

// ---------------------------------------------------------------------------
// Matrix helpers (read-only)
// ---------------------------------------------------------------------------

async function readEncryptionKeyIndex(
  roomId: string,
  accessToken: string,
  homeServerUrl: string,
): Promise<EncryptionKeyIndexContent | null> {
  const response = await fetch(
    `${homeServerUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${STATE_EVENT_TYPE}/${STATE_KEY}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to read encryption key index (status ${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as EncryptionKeyIndexContent;
}

async function fetchTimelineEvent(
  roomId: string,
  accessToken: string,
  homeServerUrl: string,
  eventId: string,
): Promise<{ encrypted_private_key: string }> {
  const response = await fetch(
    `${homeServerUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch encryption key event ${eventId}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    content: { encrypted_private_key: string };
  };
  if (!data?.content?.encrypted_private_key) {
    throw new Error(
      `Encryption key event ${eventId} has no encrypted_private_key`,
    );
  }

  return data.content;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load an existing P-256 encryption key from Matrix room state.
 * Returns null if no key has been provisioned yet.
 *
 * Key provisioning is done via the CLI:
 *   oracles-cli setup-encryption-key
 */
export async function loadEncryptionKey({
  matrixRoomId,
  matrixAccessToken,
  pin,
  signerDid,
}: LoadEncryptionKeyParams): Promise<EncryptionKeyResult | null> {
  Logger.info('[loadEncryptionKey] Loading P-256 encryption key from Matrix', {
    matrixRoomId,
    signerDid,
  });

  const homeServerUrl = await getMatrixHomeServerForDid(signerDid);

  let indexContent: EncryptionKeyIndexContent | null;
  try {
    indexContent = await readEncryptionKeyIndex(
      matrixRoomId,
      matrixAccessToken,
      homeServerUrl,
    );
  } catch (error) {
    Logger.error(
      '[loadEncryptionKey] Failed to read encryption key state',
      error,
    );
    return null;
  }

  if (!indexContent?.keys) {
    Logger.warn(
      '[loadEncryptionKey] No encryption key found. ' +
        'Run "oracles-cli setup-encryption-key" to provision one.',
    );
    return null;
  }

  const entries = Object.entries(indexContent.keys);
  const activeKv = entries.find(([, entry]) => entry.active);
  if (!activeKv) {
    Logger.warn('[loadEncryptionKey] Key index exists but no active key found');
    return null;
  }

  const [activeUuid, activeEntry] = activeKv;
  Logger.info(`[loadEncryptionKey] Found active key: ${activeUuid}`);

  const eventContent = await fetchTimelineEvent(
    matrixRoomId,
    matrixAccessToken,
    homeServerUrl,
    activeEntry.eventId,
  );

  const privateJwk = JSON.parse(
    decrypt(eventContent.encrypted_private_key, pin),
  ) as JWK;

  Logger.info('[loadEncryptionKey] Decrypted existing private key');

  return {
    privateJwk,
    publicKeyId: activeEntry.didVerificationMethodId,
  };
}
