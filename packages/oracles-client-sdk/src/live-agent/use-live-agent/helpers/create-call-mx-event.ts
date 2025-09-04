import type { OraclesCallMatrixEvent } from '@ixo/matrix';
import { CryptoUtils } from '@ixo/oracles-chain-client/react';
import type { MatrixClient, TimelineEvents } from 'matrix-js-sdk';
import { getPublicKeyBase58 } from './get-public-ket.js';
interface CreateCallMxEventParams {
  oracleAccountDid: string;
  mxClient: MatrixClient;
  roomId: string;
  callType: 'audio' | 'video';
  sessionId: string;
  userDid: string;
}

/**
 * Create a call event in the Matrix room
 * @param params - The parameters for creating the call event
 * @returns The event ID
 */
const createCallMxEvent = async (
  params: CreateCallMxEventParams,
): Promise<{
  callId: string;
  encryptionKey: string;
}> => {
  if (!window.crypto || !window.crypto.getRandomValues) {
    throw new Error('Crypto is not supported in this browser');
  }

  // 1. Generate unique encryption key
  // Generate 32-byte (256-bit) cryptographically secure random key
  const encryptionKey = Array.from(
    window.crypto.getRandomValues(new Uint8Array(32)),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const publicKeyBase58 = await getPublicKeyBase58(params.oracleAccountDid);
  if (!publicKeyBase58) {
    throw new Error('Public key base58 not found');
  }

  const encryptedEncryptionKey = CryptoUtils.encrypt(
    encryptionKey,
    publicKeyBase58,
  );

  const callEvent: OraclesCallMatrixEvent = {
    type: 'm.ixo.oracles_call',
    content: {
      callType: params.callType,
      callStatus: 'pending',
      callStartedAt: new Date().toISOString(),
      callEndedAt: undefined,
      encryptionKey: encryptedEncryptionKey,
      sessionId: params.sessionId,
      oracleDid: params.oracleAccountDid,
      userDid: params.userDid,
    },
  };

  const event = await params.mxClient.sendEvent(
    params.roomId,
    callEvent.type as keyof TimelineEvents,
    callEvent.content as any,
  );
  return { callId: `${event.event_id}@${params.roomId}`, encryptionKey };
};

export default createCallMxEvent;
