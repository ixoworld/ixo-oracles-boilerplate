import { Client } from './client.js';
import { Entities } from './entities/entity.js';

/**
 * Light client barrel: Client, Authz, Entities, crypto-utils, create-wallet-from-mnemonics, errors.
 * Does NOT export claims, payments, or create-credentials (Veramo-free).
 */
export const IXO = {
  entities: Entities,
  client: Client,
};

export * from './authz/index.js';
export * from './client.js';
export * from './create-wallet-from-mnemonics.js';
export * from './crypto-utils.js';
export * from './entities/index.js';
export * from './errors/matrix.js';
