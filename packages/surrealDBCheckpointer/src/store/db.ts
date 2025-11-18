import { ConnectionStatus, Surreal } from 'surrealdb';
import { SurrealDBConnectionConfig } from './types.js';

// Singleton SurrealDB instance
let _db: Surreal | null = null;
let _config: SurrealDBConnectionConfig | null = null;

/**
 * Initialize the SurrealDB connection with configuration.
 */
export async function initDb(config: SurrealDBConnectionConfig): Promise<void> {
  _config = config;
  _db = new Surreal({});

  await _db.connect(config.url);

  // Select namespace and database if provided
  if (config.namespace && config.database) {
    await _db.use({
      namespace: config.namespace,
      database: config.database,
    });
  }

  // Authenticate if credentials provided
  if (config.auth) {
    if (config.auth.token) {
      await _db.authenticate(config.auth.token);
    } else if (config.auth.username && config.auth.password) {
      await _db.signin({
        username: config.auth.username,
        password: config.auth.password,
      });
    }
  }
}

/**
 * Get the SurrealDB instance, creating a connection if needed.
 */
export async function getDb(): Promise<Surreal> {
  if (!_db || !_config) {
    throw new Error(
      'Database not initialized. Call initDb() with configuration first.',
    );
  }

  // Reconnect if connection was lost
  if (_db.connection?.status !== ConnectionStatus.Connected) {
    await _db.connect(_config.url);

    if (_config.namespace && _config.database) {
      await _db.use({
        namespace: _config.namespace,
        database: _config.database,
      });
    }

    if (_config.auth) {
      if (_config.auth.token) {
        await _db.authenticate(_config.auth.token);
      } else if (_config.auth.username && _config.auth.password) {
        await _db.signin({
          username: _config.auth.username,
          password: _config.auth.password,
        });
      }
    }
  }

  return _db;
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
    _config = null;
  }
}
