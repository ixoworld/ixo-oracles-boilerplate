export interface IApiKeyRecord {
  /** primary key ID */
  id: number;
  /** Hashed value of the API key combined with salt and pepper */
  keyHash: string;
  /** Random value used in combination with pepper to hash the API key */
  salt: string;
  /** Timestamp when the API key was created */
  createdAt: Date;
  /** Timestamp of the most recent API key usage */
  lastUsedAt: Date;
  /** Timestamp when the API key will expire */
  expiresAt: Date;
  /** Timestamp when the API key was revoked, or null if not revoked */
  revokedAt: Date | null;
}
