---
'@ixo/oracles-chain-client': minor
'@ixo/oracles-client-sdk': minor
'@ixo/common': minor
'@ixo/matrix': minor
'app': minor
---

# Live Agent: Ultra-Secure Voice & Video Calls

This major release introduces **Live Agent Mode** - enabling real-time voice and video conversations with AI oracles through ultra-secure, end-to-end encrypted calls.

## ✨ Key Features

- **Double Encryption Security**: Asymmetric key encryption + Matrix E2EE for maximum security
- **Real-time Communication**: LiveKit integration for professional-grade WebRTC infrastructure
- **Frontend-Controlled Keys**: True E2EE with user-generated encryption keys
- **Zero-Trust Architecture**: Backend services cannot decrypt call content
- **Per-Call Key Rotation**: Unique encryption keys for each call session

## 🏗️ New Components

- `useLiveAgent` hook for voice chat integration
- `useLiveKitAgent` for E2EE connection management
- Complete call lifecycle with state validation
- Enhanced Matrix integration for encrypted events

## 🛡️ Security Enhancements

- ECIES-based encryption/decryption utilities
- Cryptographically secure key generation
- Live Agent authentication via API keys
- Enhanced wallet generation with public key encoding

## 📡 New API Endpoints

- `POST /calls/:callId/sync` - Sync call state from Matrix event
- `GET /calls/:callId/key` - Get encrypted key for Live Agent
- `PATCH /calls/:callId/update` - Update call status with validation
- `GET /calls/session/:sessionId` - List user's call history

## ⚠️ Breaking Changes

- **Backend only**: New environment variables required in your backend configuration:
  - `LIVE_AGENT_AUTH_API_KEY` - Authentication for Live Agent
  - `MEMORY_MCP_URL` - Memory management service URL
  - `MEMORY_MCP_API` - Memory management API endpoint
- Updated dependencies for LiveKit and enhanced Matrix client

## 📚 Documentation

- [Live Agent Architecture](./docs/architecture/calls.md) - Complete technical documentation
- [Crypto Utilities](./packages/oracles-chain-client/docs/crypto.md) - Encryption implementation details

This release represents a major milestone in secure, real-time AI communication, enabling truly private voice conversations with AI oracles through state-of-the-art encryption and professional-grade infrastructure.
