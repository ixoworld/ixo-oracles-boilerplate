# API Keys Manager - Technical Documentation

This document explains the technical decisions and security architecture behind the API Keys Manager.

## Understanding API Key Security

### Why Not Just Random Strings?

While it might be tempting to just generate and store random strings as API keys, this approach has several security vulnerabilities:

- If your database is compromised, all API keys are immediately exposed
- No way to safely validate keys without exposing them
- No protection against rainbow table attacks
- Keys stored in plain text can be read by database administrators

### Our Three-Layer Security Approach

We implement a robust security model using three distinct layers:

1. **The API Key** (What the user sees)
   - Generated as a cryptographically secure random string
   - Formatted in base64url for safe transmission
   - Never stored in its original form
   - Example: `dBjPXwknZuZF0j_KFWBgAB1Zj5Piz-OWJcwTxjZhQpc`

2. **The Salt** (Unique per key)
   - Random value generated for each API key
   - Stored alongside the hash in the database
   - Prevents rainbow table attacks
   - Makes each key hash unique, even if two users somehow get the same API key

3. **The Pepper** (Server secret)
   - A server-side secret that's never stored in the database
   - Adds an extra layer of security
   - Even if the database is compromised, the keys remain secure
   - Must be kept in secure environment variables

### How Key Generation Works

1. When a new key is requested:
   - Generate a secure random API key
   - Generate a unique salt for this key
   - Generate a unique identifier (for reference)

2. Before storage:
   - Combine pepper (server secret) + salt + API key
   - Hash the combined value using SHA-256
   - Store only the hash, salt, and metadata

3. When validating:
   - Take the provided API key
   - Retrieve the salt from the database
   - Combine with the server's pepper
   - Hash and compare with stored hash

This means that even if an attacker gets your entire database, they still can't:

- Reverse the hashes without the pepper
- Generate valid new keys
- Modify existing keys

## Database Design Philosophy

### Why SQLite?

We chose SQLite for several reasons:

- Embedded database, no separate server needed
- ACID compliant, perfect for key management
- Excellent performance for our use case
- Simple to backup and maintain

### Schema Design Decisions

Our schema is designed around key lifecycle management:

- **ID**: Unique identifier for referencing keys without exposing hashes
- **Key Hash**: The secure hash of the complete key
- **Salt**: Unique per-key random value
- **Timestamps**: Track creation, usage, expiration, and revocation

### Why These Specific Indexes?

We've carefully chosen indexes to optimize the most common operations:

1. **Validity Check Index**
   - Most frequent operation: checking if a key is valid
   - Combines ID, revocation, and expiration checks
   - Optimizes the critical path of API key validation

2. **Management Indexes**
   - Support administrative operations
   - Enable efficient key lifecycle management
   - Help with maintenance tasks

## Performance and Scaling

### Read vs Write Optimization

API key systems are typically read-heavy:

- Key validation happens frequently
- Key creation/revocation is relatively rare
- Our indexes optimize for this pattern

### When to Consider PostgreSQL

While SQLite is excellent, consider PostgreSQL when you need:

- More than 10 million active keys
- Multiple servers accessing the keys
- Complex querying requirements
- Horizontal scaling

## Security Best Practices

### Pepper Management

The pepper is crucial for security:

1. Store it securely in environment variables
2. Use different peppers for different environments
3. Have a plan for pepper rotation
4. Never store it in the database or code

### Key Lifecycle

Implement these practices for better security:

1. Regular key rotation (e.g., every 90 days)
2. Automatic expiration
3. Quick revocation capability
4. Usage tracking for suspicious activity

### Attack Prevention

Our design prevents common attacks:

1. **Rainbow Table Attacks**: Prevented by per-key salts
2. **Database Compromise**: Protected by server-side pepper
3. **Brute Force**: Mitigated by key length and complexity
4. **Timing Attacks**: Using constant-time comparisons

## Monitoring and Maintenance

### What to Monitor

1. **Key Usage Patterns**
   - Sudden spikes in validation attempts
   - Failed validation patterns
   - Usage from unexpected locations

2. **Database Health**
   - Number of active keys
   - Expiration patterns
   - Revocation rates

### Regular Maintenance

1. **Cleanup Tasks**
   - Remove expired keys
   - Archive revoked keys
   - Update usage statistics

2. **Security Tasks**
   - Rotate long-lived keys
   - Review failed attempts
   - Audit key creation patterns
