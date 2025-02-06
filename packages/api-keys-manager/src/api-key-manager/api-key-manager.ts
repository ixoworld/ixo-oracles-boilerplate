import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { type IApiKeyRecord } from 'src/types';
import { hashApiKey } from './utils/hash';

export class ApiKeyManager {
  constructor(
    private readonly db: Database.Database = new Database('memory.db'),
    private readonly config: {
      /**
       * The length of the API key hash.
       * @defaultValue 32
       */
      keyHashLength: number;
      /**
       * The expiration date of the API key in days.
       * @defaultValue 365
       */
      keyHashExpiration: number;
      /**
       * A secret key used as a pepper in the hashing process.
       * This should be a secure random string stored in environment variables.
       * @defaultValue crypto.randomBytes(32).toString('hex')
       */
      pepper: string;
    } = {
      keyHashLength: 32,
      keyHashExpiration: 365,
      pepper: process.env.API_KEY_PEPPER ?? '',
    },
  ) {
    this.initializeDB();
    if (!this.config.pepper) {
      throw new Error('API_KEY_PEPPER is not set');
    }
  }

  /**
   * Create the api_keys table if it doesn't exist.
   */
  private initializeDB(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        keyHash TEXT NOT NULL,
        salt TEXT NOT NULL,
        createdAt DATETIME NOT NULL,
        lastUsedAt DATETIME NOT NULL,
        expiresAt DATETIME NOT NULL,
        revokedAt DATETIME,
        UNIQUE(keyHash, salt)
      );

      -- Index for key hash lookups (used in deleteKeyByHash)
      CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(keyHash);

      -- Composite index for validity checks (used in checkKey)
      CREATE INDEX IF NOT EXISTS idx_api_keys_validity ON api_keys(id, revokedAt, expiresAt);

    `;
    this.db.exec(createTableSQL);
  }

  /**
   * Create a new API key.
   * @returns An object containing the generated API key
   */
  public createKey(): { apiKey: string; keyId: string } {
    // Generate a secure random API key for the client
    const apiKey = crypto
      .randomBytes(this.config.keyHashLength)
      .toString('base64url');

    // Generate a random salt
    const salt = crypto.randomBytes(16).toString('hex');

    // Hash the API key with both salt and pepper using SHA-256
    // In production, consider using bcrypt or Argon2 for even better security
    const keyHash = hashApiKey(apiKey, salt, this.config.pepper);

    const expiresAt = new Date(
      Date.now() + this.config.keyHashExpiration * 24 * 60 * 60 * 1000,
    );

    const insertSQL = `
     INSERT INTO api_keys (id, keyHash, salt, createdAt, lastUsedAt, expiresAt, revokedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const keyId = crypto.randomBytes(16).toString('hex');
    this.db
      .prepare(insertSQL)
      .run(
        keyId,
        keyHash,
        salt,
        new Date().toISOString(),
        new Date().toISOString(),
        expiresAt.toISOString(),
        null,
      );

    return { apiKey, keyId };
  }

  /**
   * Delete an API key.
   * @param id - The ID of the API key to delete.
   */
  public deleteKeyById(id: string): void {
    const deleteSQL = `DELETE FROM api_keys WHERE id = ?`;
    this.db.prepare(deleteSQL).run(id);
  }

  /**
   * Delete an API key by its hash.
   * @param keyHash - The hash of the API key to delete.
   */
  public deleteKeyByHash(keyHash: string): void {
    const deleteSQL = `DELETE FROM api_keys WHERE keyHash = ?`;
    this.db.prepare(deleteSQL).run(keyHash);
  }

  /**
   * Check if an API key is valid.
   * @param apiKey - The API key to validate
   * @param id - The ID of the API key to validate
   * @returns True if the API key is valid, false otherwise
   */
  public checkKey(apiKey: string, id: string): boolean {
    const checkSQL = `SELECT keyHash, salt, revokedAt, expiresAt FROM api_keys WHERE id = ? AND revokedAt IS NULL AND expiresAt > ?`;
    const record = this.db
      .prepare<
        [string, string],
        {
          keyHash: string;
          salt: string;
          revokedAt: string | null;
          expiresAt: string;
        }
      >(checkSQL)
      .get(id, new Date().toISOString());

    // If no record found, or if the key is revoked or expired, return false
    if (!record) {
      return false;
    }

    // Recompute the hash using the stored salt and your pepper
    const computedHash = hashApiKey(apiKey, record.salt, this.config.pepper);
    return computedHash === record.keyHash;
  }

  /**
   * Update the last used timestamp for an API key.
   * @param id - The ID of the API key to update
   * @param lastUsedAt - The timestamp to set as the last used timestamp
   */
  public updateLastUsed(id: string): string {
    const record = this.db
      .prepare<
        [string],
        IApiKeyRecord
      >(`SELECT lastUsedAt FROM api_keys WHERE id = ?`)
      .get(id);

    if (!record) {
      throw new Error('API key not found');
    }
    const updateSQL = `UPDATE api_keys SET lastUsedAt = ? WHERE id = ?`;
    const lastUsedAt = new Date().toISOString();
    this.db.prepare(updateSQL).run(lastUsedAt, id);
    return lastUsedAt;
  }

  /**
   * Revoke an API key by marking it as deleted.
   * @param id - The ID of the API key to revoke
   */
  public revokeKey(id: string): void {
    const record = this.db
      .prepare<
        [string],
        IApiKeyRecord
      >(`SELECT revokedAt FROM api_keys WHERE id = ?`)
      .get(id);
    if (!record) {
      throw new Error('API key not found');
    }
    const revokeSQL = `UPDATE api_keys SET revokedAt = ? WHERE id = ?`;
    this.db.prepare(revokeSQL).run(new Date().toISOString(), id);
  }

  /**
   * Get API keys with pagination.
   * @param page - The page number (1-based)
   * @param pageSize - Number of records per page
   * @returns An array of API keys for the requested page
   */
  public getAllKeys(page = 1, pageSize = 10): IApiKeyRecord[] {
    const offset = (page - 1) * pageSize;
    const selectSQL = `
      SELECT * FROM api_keys
      LIMIT ? OFFSET ?
    `;
    return this.db
      .prepare<[number, number], IApiKeyRecord>(selectSQL)
      .all(pageSize, offset);
  }
}
