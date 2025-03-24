import  Client from './client.js';
import { Entities } from './entities/entity.js';

// Create a singleton client instance

// Export a namespace object with static access to entity methods
export class IXO {
  static entities = Entities;
  static client = Client;
}

export * from './entities/create-entity/index.js';
export * from './errors/matrix.js';
export * from './authz/index.js';