import Database from 'better-sqlite3';
import { type IApiKeyRecord } from 'src/types';
import { ApiKeyManager } from '../api-key-manager';

describe('ApiKeyManager', () => {
  let apiKeyManager: ApiKeyManager;
  let db: Database.Database;
  const testPepper = 'test-pepper-for-unit-tests';

  beforeEach(() => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    process.env.API_KEY_PEPPER = testPepper;
    apiKeyManager = new ApiKeyManager(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('initialization', () => {
    it('should throw error if pepper is not set', () => {
      delete process.env.API_KEY_PEPPER;
      expect(() => new ApiKeyManager(db)).toThrow('API_KEY_PEPPER is not set');
    });

    it('should create api_keys table on initialization', () => {
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'",
        )
        .get();
      expect(tableExists).toBeTruthy();
    });
  });

  describe('createKey', () => {
    it('should create a new API key with correct format', () => {
      const { apiKey, keyId } = apiKeyManager.createKey();

      expect(apiKey).toBeTruthy();
      expect(typeof apiKey).toBe('string');
      expect(keyId).toBeTruthy();
      expect(typeof keyId).toBe('string');
    });

    it('should store the key in database with correct schema', () => {
      const { keyId } = apiKeyManager.createKey();

      const storedKey = db
        .prepare<[string], IApiKeyRecord>('SELECT * FROM api_keys WHERE id = ?')
        .get(keyId);

      expect(storedKey).toBeTruthy();
      expect(storedKey?.keyHash).toBeTruthy();
      expect(storedKey?.salt).toBeTruthy();
      expect(storedKey?.createdAt).toBeTruthy();
      expect(storedKey?.lastUsedAt).toBeTruthy();
      expect(storedKey?.expiresAt).toBeTruthy();
      expect(storedKey?.revokedAt).toBeNull();
    });
  });

  describe('checkKey', () => {
    let apiKey: string;
    let keyId: string;

    beforeEach(() => {
      const result = apiKeyManager.createKey();
      apiKey = result.apiKey;
      keyId = result.keyId;
    });

    it('should return true for valid key', () => {
      const isValid = apiKeyManager.checkKey(apiKey, keyId);
      expect(isValid).toBe(true);
    });

    it('should return false for invalid key', () => {
      const isValid = apiKeyManager.checkKey('invalid-key', keyId);
      expect(isValid).toBe(false);
    });

    it('should return false for invalid id', () => {
      const isValid = apiKeyManager.checkKey(apiKey, 'invalid-id');
      expect(isValid).toBe(false);
    });

    it('should return false for revoked key', () => {
      apiKeyManager.revokeKey(keyId);
      const isValid = apiKeyManager.checkKey(apiKey, keyId);
      expect(isValid).toBe(false);
    });
  });

  describe('revokeKey', () => {
    it('should mark key as revoked', () => {
      const { keyId } = apiKeyManager.createKey();

      apiKeyManager.revokeKey(keyId);

      const storedKey = db
        .prepare<
          [string],
          IApiKeyRecord
        >('SELECT revokedAt FROM api_keys WHERE id = ?')
        .get(keyId);

      expect(storedKey?.revokedAt).toBeTruthy();
    });

    it('should throw error if key is not found', () => {
      expect(() => {
        apiKeyManager.revokeKey('invalid-id');
      }).toThrow();
    });
  });

  describe('updateLastUsed', () => {
    it('should update lastUsedAt timestamp', () => {
      const { keyId } = apiKeyManager.createKey();

      const lastUsedAt = apiKeyManager.updateLastUsed(keyId);

      const storedKey = db
        .prepare<
          [string],
          IApiKeyRecord
        >('SELECT lastUsedAt FROM api_keys WHERE id = ?')
        .get(keyId);

      expect(new Date(storedKey!.lastUsedAt)).toEqual(new Date(lastUsedAt));
    });

    it('should throw error if key is not found', () => {
      expect(() => {
        apiKeyManager.updateLastUsed('invalid-id');
      }).toThrow();
    });
  });

  describe('getAllKeys', () => {
    beforeEach(() => {
      // Create multiple keys for pagination testing
      for (let i = 0; i < 15; i++) {
        apiKeyManager.createKey();
      }
    });

    it('should return correct number of keys per page', () => {
      const pageSize = 5;
      const keys = apiKeyManager.getAllKeys(1, pageSize);
      expect(keys.length).toBe(pageSize);
    });

    it('should return different keys for different pages', () => {
      const page1Keys = apiKeyManager.getAllKeys(1, 5);
      const page2Keys = apiKeyManager.getAllKeys(2, 5);

      const page1Ids = new Set(page1Keys.map((k) => k.id));
      const page2Ids = new Set(page2Keys.map((k) => k.id));

      // Check that no IDs overlap between pages
      const overlap = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('deleteKeyById', () => {
    it('should delete key by id', () => {
      const { keyId } = apiKeyManager.createKey();

      apiKeyManager.deleteKeyById(keyId);

      const storedKey = db
        .prepare('SELECT * FROM api_keys WHERE id = ?')
        .get(keyId);
      expect(storedKey).toBeUndefined();
    });
  });

  describe('deleteKeyByHash', () => {
    it('should delete key by hash', () => {
      const { keyId } = apiKeyManager.createKey();

      const keyHash =
        db
          .prepare<
            [string],
            IApiKeyRecord
          >('SELECT keyHash FROM api_keys WHERE id = ?')
          .get(keyId)?.keyHash ?? '';

      apiKeyManager.deleteKeyByHash(keyHash);

      const storedKey = db
        .prepare('SELECT * FROM api_keys WHERE id = ?')
        .get(keyId);
      expect(storedKey).toBeUndefined();
    });
  });
});
