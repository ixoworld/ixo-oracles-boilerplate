import {
  MemoryCryptoStore,
  MemoryStore,
  createClient,
  type ICreateClientOpts,
  type MatrixClient,
} from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import {
  cacheSecretStorageKey,
  getSecretStorageKey,
} from './secret-storage-keys';

logger.setLevel('ERROR');

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

  storeOpts.cryptoStore = new MemoryCryptoStore();
  storeOpts.store = new MemoryStore({});

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
