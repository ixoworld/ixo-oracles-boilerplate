import Client from './client.js';
import { Entities } from './entities/entity.js';

// Create a singleton client instance

export const IXO = {
  entities: Entities,
  client: Client,
};

export * from './authz/index.js';
export * from './entities/create-entity/index.js';
export * from './errors/matrix.js';
