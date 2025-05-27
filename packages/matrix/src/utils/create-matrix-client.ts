import {
  LocalStorageCryptoStore,
  MemoryStore,
  createClient,
  type ICreateClientOpts,
  type MatrixClient,
} from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { LocalJsonStorage } from '../local-storage/local-storage';
import {
  cacheSecretStorageKey,
  getSecretStorageKey,
} from './secret-storage-keys';

logger.setLevel('ERROR');

const cryptoStore = new LocalStorageCryptoStore(
  new LocalJsonStorage(
    process.env.MATRIX_CRYPTO_STORE_PATH || './matrix-crypto-store-new',
  ),
);
const store = new MemoryStore({
  localStorage: new LocalJsonStorage(
    process.env.MATRIX_STORE_PATH || './matrix-store-new',
  ),
});

// const store = new LocalStorage('./scratch');

/**
 * Create a new matrix client, with the persistent stores set up appropriately
 *
 * @returns  the newly-created MatrixClient
 */
export default function createMatrixClient(
  opts: ICreateClientOpts,
): MatrixClient {
  const storeOpts: Partial<ICreateClientOpts> = {
    useAuthorizationHeader: true,
  };

  storeOpts.cryptoStore = cryptoStore;
  storeOpts.store = store;

  return createClient({
    ...storeOpts,
    ...opts,
    verificationMethods: ['m.sas.v1'],
    timelineSupport: true,
    // cryptoCallbacks,
    cryptoCallbacks: {
      getSecretStorageKey,
      cacheSecretStorageKey,
    },
  });
}
