import { Logger } from '@ixo/logger';
import { ClientEvent, createClient } from 'matrix-js-sdk';
import {
  cacheSecretStorageKey,
  getSecretStorageKey,
} from './secretStorageKeys.js';

export async function createMatrixClient({
  homeServerUrl,
  accessToken,
  userId,
  deviceId,
}: {
  homeServerUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}) {
  if (!homeServerUrl || !accessToken || !userId || !deviceId) {
    throw new Error(
      'Login to Matrix account before trying to instantiate Matrix client.',
    );
  }

  const mxClient = createClient({
    baseUrl: homeServerUrl,
    accessToken,
    userId,
    deviceId,
    timelineSupport: true,
    cryptoCallbacks: {
      getSecretStorageKey,
      cacheSecretStorageKey,
    },
    verificationMethods: ['m.sas.v1'],
  });
  await mxClient.initRustCrypto({
    useIndexedDB: false,
  });
  // mxClient.setGlobalErrorOnUnknownDevices(false);
  mxClient.setMaxListeners(20);
  await mxClient.startClient({
    lazyLoadMembers: true,
    // initialSyncLimit: 1,
    includeArchivedRooms: false,
    // pollTimeout: 2 * 60 * 1000, // poll every 2 minutes
    // filter: filter,
  });
  await new Promise<void>((resolve, reject) => {
    const sync = {
      NULL: () => {
        Logger.info('[NULL] state');
      },
      SYNCING: () => {
        void 0;
      },
      PREPARED: () => {
        Logger.info(`[PREPARED] state: user ${userId}`);
        resolve();
      },
      RECONNECTING: () => {
        Logger.info('[RECONNECTING] state');
      },
      CATCHUP: () => {
        Logger.info('[CATCHUP] state');
      },
      ERROR: () => {
        reject(new Error('[ERROR] state: starting matrix client'));
      },
      STOPPED: () => {
        Logger.info('[STOPPED] state');
      },
    };
    mxClient.on(ClientEvent.Sync, (state) => {
      sync[state]();
    });
  });
  return mxClient;
}
