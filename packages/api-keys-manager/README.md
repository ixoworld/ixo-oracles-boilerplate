# @ixo/api-keys-manager

Secure API key management system for Node.js applications. Handles key generation, validation, and lifecycle management with built-in security best practices.

## Features

- ✨ Secure API key generation with salt and pepper
- 🔒 Safe key storage with SHA-256 hashing
- ⏰ Automatic key expiration
- 🔄 Key revocation support
- 📊 Built-in pagination for key listing
- 🎯 Key usage tracking
- 🚀 Optimized for high-performance

## Installation

```bash
# Using pnpm (recommended)
pnpm add @ixo/api-keys-manager

# Using npm
npm install @ixo/api-keys-manager

# Using yarn
yarn add @ixo/api-keys-manager
```

## Quick Start

1. Set up your environment:

```env
API_KEY_PEPPER=your-secure-random-string
```

2. Initialize the manager:

You can initialize the manager with a SQLite database or let it create one automatically. The manager supports several configuration options:

```typescript
import { ApiKeyManager } from '@ixo/api-keys-manager';
import Database from 'better-sqlite3';

const manager = new ApiKeyManager(new Database('keys.db'));
```

## API Reference

### Creating Keys

The user should generate a new API key and store both the key and the keyId in safe place.

```typescript
// Generate a new API key
const { apiKey, keyId } = manager.createKey();
```

- `apiKey`: The key to provide to your API users
- `keyId`: Internal reference ID for the key

### Validating Keys

```typescript
// Check if a key is valid
const isValid = manager.checkKey(apiKey, keyId);
if (isValid) {
  // Key is valid, not expired, and not revoked
}
```

### Managing Keys

```typescript
// Revoke a key
manager.revokeKey(keyId);

// Update last used timestamp
manager.updateLastUsed(keyId);

// Delete a key
manager.deleteKeyById(keyId);

// List keys with pagination
const keys = manager.getAllKeys((page = 1), (pageSize = 10));
```

## Configuration Options

```typescript
const manager = new ApiKeyManager(db, {
  // Length of generated API keys (default: 32)
  keyHashLength: 32,

  // Days until key expiration (default: 365)
  keyHashExpiration: 365,

  // Server-side secret for additional security
  pepper: process.env.API_KEY_PEPPER,
});
```

## Error Handling

The module throws specific errors that you can handle:

```typescript
try {
  const isValid = manager.checkKey(apiKey, keyId);
} catch (error) {
  if (error.message === 'API_KEY_PEPPER is not set') {
    // Handle configuration error
  }
}
```

## Best Practices

1. **Environment Variables**
   - Always store your pepper in environment variables - if you lost it, you will not be able to validate any keys
   - Use different peppers for different environments - this will make it harder to break the security of the system

2. **Key Management**
   - Implement key rotation policies
   - Set appropriate expiration periods
   - Monitor failed validation attempts

3. **Security**
   - Enable rate limiting on validation endpoints
   - Regularly backup your database
   - Monitor for suspicious activity

## Documentation

- [Technical Details](./TECHNICAL.md) - In-depth technical documentation
