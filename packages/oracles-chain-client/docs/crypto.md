# Crypto Utilities

ECIES-based encryption and decryption utilities for secure data handling in oracle operations.

## Overview

The crypto utilities module provides secure encryption/decryption capabilities using Elliptic Curve Integrated Encryption Scheme (ECIES). This allows oracles to encrypt sensitive data using secp256k1 keys derived from mnemonics.

## Key Features

- **ECIES Encryption**: Industry-standard elliptic curve encryption
- **Mnemonic-based Keys**: Uses wallet mnemonics to derive encryption keys
- **Type-safe Decryption**: Zod schema validation for decrypted data
- **Base64 Encoding**: Database and API-friendly string output
- **Automatic JSON Handling**: Smart detection of object vs string data types

## Installation

```typescript
import { CryptoUtils } from '@ixo/oracles-chain-client';
```

## Basic Usage

### Encrypt Data

```typescript
import { CryptoUtils, generateServerWallet } from '@ixo/oracles-chain-client';

// Generate wallet for encryption keys
const mnemonic = 'your mnemonic phrase here...';
const wallet = await generateServerWallet(mnemonic);

// Encrypt simple string
const encryptedData = CryptoUtils.encrypt(
  'Hello, world!',
  wallet.publicKeyBase58,
);
console.log(encryptedData); // Base64 encoded string
```

### Decrypt Data

```typescript
// Decrypt to string
const decryptedString = CryptoUtils.decrypt(encryptedData, wallet.privateKey);
console.log(decryptedString); // "Hello, world!"
```

### Type-safe Decryption with Zod

```typescript
import { z } from 'zod';

// Define expected data structure
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string(),
});

// Encrypt complex object
const userData = {
  name: 'John Doe',
  age: 30,
  email: 'john@example.com',
};

const encryptedUserData = CryptoUtils.encrypt(
  JSON.stringify(userData),
  wallet.publicKeyBase58,
);

// Decrypt with type safety
const decryptedUser = CryptoUtils.decryptTyped(
  encryptedUserData,
  wallet.privateKey,
  UserSchema,
);

console.log(decryptedUser.name); // TypeScript knows this is a string
console.log(decryptedUser.age); // TypeScript knows this is a number
```

## API Reference

### `CryptoUtils.encrypt(data, publicKeyBase58)`

Encrypts data using ECIES with the provided public key.

**Parameters:**

- `data: string` - The data to encrypt
- `publicKeyBase58: string` - Base58-encoded public key for encryption

**Returns:** `string` - Base64-encoded encrypted data

### `CryptoUtils.decrypt(encryptedData, privateKey)`

Decrypts ECIES-encrypted data using the private key.

**Parameters:**

- `encryptedData: string` - Base64-encoded encrypted data
- `privateKey: Uint8Array` - Private key for decryption

**Returns:** `string` - Decrypted data as string

### `CryptoUtils.decryptTyped<T>(encryptedData, privateKey, zodSchema)`

Decrypts and validates data against a Zod schema with automatic JSON parsing.

**Parameters:**

- `encryptedData: string` - Base64-encoded encrypted data
- `privateKey: Uint8Array` - Private key for decryption
- `zodSchema: ZodSchema<T>` - Zod schema for validation

**Returns:** `T` - Typed and validated decrypted data

## Advanced Usage

### Oracle Data Storage

```typescript
// Encrypt user session data for database storage
const sessionData = {
  userId: 'user123',
  preferences: { theme: 'dark' },
  lastSeen: new Date().toISOString(),
};

const encrypted = CryptoUtils.encrypt(
  JSON.stringify(sessionData),
  oracle.publicKeyBase58,
);

// Store in database
await db.sessions.create({
  sessionId: 'session123',
  encryptedData: encrypted, // Base64 string, DB-friendly
});
```

### API Response Encryption

```typescript
// Encrypt sensitive API responses
const sensitiveResponse = {
  apiKey: 'secret-key-123',
  userToken: 'jwt-token-here',
  permissions: ['read', 'write'],
};

const encryptedResponse = CryptoUtils.encrypt(
  JSON.stringify(sensitiveResponse),
  clientPublicKeyBase58,
);

// Send encrypted response
res.json({
  encrypted: encryptedResponse,
  timestamp: Date.now(),
});
```

### Smart Type Detection

The `decryptTyped` method automatically detects whether to parse JSON based on the Zod schema:

```typescript
// String schemas - no JSON parsing
const stringData = CryptoUtils.decryptTyped(encrypted, privateKey, z.string());

// Object schemas - automatic JSON parsing
const objectData = CryptoUtils.decryptTyped(
  encrypted,
  privateKey,
  z.object({ name: z.string() }),
);

// Array schemas - automatic JSON parsing
const arrayData = CryptoUtils.decryptTyped(
  encrypted,
  privateKey,
  z.array(z.string()),
);
```

## Security Considerations

- **Key Management**: Private keys should never be exposed in logs or client-side code
- **Mnemonic Security**: Store mnemonics securely using environment variables or secure vaults
- **Transport Security**: Always use HTTPS when transmitting encrypted data
- **Database Security**: Encrypted data in databases is still sensitive metadata

## Integration with Wallet Generation

```typescript
import { generateServerWallet, CryptoUtils } from '@ixo/oracles-chain-client';

// Generate oracle wallet
const mnemonic = process.env.ORACLE_MNEMONIC;
const oracleWallet = await generateServerWallet(mnemonic);

// Use for encryption in oracle operations
const encryptUserData = (userData: any) => {
  return CryptoUtils.encrypt(
    JSON.stringify(userData),
    oracleWallet.publicKeyBase58,
  );
};

const decryptUserData = <T>(
  encryptedData: string,
  schema: z.ZodSchema<T>,
): T => {
  return CryptoUtils.decryptTyped(
    encryptedData,
    oracleWallet.privateKey,
    schema,
  );
};
```

## Error Handling

```typescript
try {
  const decrypted = CryptoUtils.decryptTyped(
    encryptedData,
    privateKey,
    UserSchema,
  );
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Data validation failed:', error.errors);
  } else {
    console.error('Decryption failed:', error.message);
  }
}
```
