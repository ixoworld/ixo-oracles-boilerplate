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
  console.log('createMatrixClient::', {
    homeServerUrl,
    accessToken,
    userId,
    deviceId,
  });

  if (!homeServerUrl || !accessToken || !userId || !deviceId) {
    throw new Error(
      'Login to Matrix account before trying to instantiate Matrix client.',
    );
  }

  // const indexedDBStore = new IndexedDBStore({
  //   indexedDB: global.indexedDB,
  //   dbName: 'matrix-sync-store',
  // });
  // const legacyCryptoStore = new IndexedDBCryptoStore()

  const mxClient = createClient({
    baseUrl: homeServerUrl,
    accessToken,
    userId,
    // store: indexedDBStore,
    // cryptoStore: legacyCryptoStore,
    deviceId,
    timelineSupport: true,
    cryptoCallbacks: {
      getSecretStorageKey: getSecretStorageKey,
      cacheSecretStorageKey: cacheSecretStorageKey,
    },
    verificationMethods: ['m.sas.v1'],
  });
  // await indexedDBStore.startup();
  await mxClient.initRustCrypto({
    useIndexedDB: false,
  });
  // mxClient.setGlobalErrorOnUnknownDevices(false);
  mxClient.setMaxListeners(20);
  // const filter = new Filter(userId);
  // filter.setDefinition({
  //   room: {
  //     state: {
  //       lazy_load_members: true,
  //       types: [],
  //     },
  //     timeline: {
  //       types: [],
  //     },
  //   },
  //   // Disable unnecessary features
  //   presence: {
  //     types: [], // No presence updates needed
  //   },
  //   account_data: {
  //     types: ['m.cross_signing.master'], // No account data needed
  //   },
  // });
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
        console.info('[NULL] state');
      },
      SYNCING: () => {
        void 0;
      },
      PREPARED: () => {
        console.info(`[PREPARED] state: user ${userId}`);
        resolve();
      },
      RECONNECTING: () => {
        console.info('[RECONNECTING] state');
      },
      CATCHUP: () => {
        console.info('[CATCHUP] state');
      },
      ERROR: () => {
        reject(new Error('[ERROR] state: starting matrix client'));
      },
      STOPPED: () => {
        console.info('[STOPPED] state');
      },
    };
    mxClient.on(ClientEvent.Sync, (state) => {
      sync[state]();
    });
  });
  return mxClient;
}
