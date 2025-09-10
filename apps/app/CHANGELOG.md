# app

## 0.2.0

### Minor Changes

- [#57](https://github.com/ixoworld/ixo-oracles-boilerplate/pull/57) [`2a3bbd3`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/2a3bbd3267e1ce9a413eba4a30757e92ee8fa87b) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - # Live Agent: Ultra-Secure Voice & Video Calls

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

### Patch Changes

- Updated dependencies [[`2a3bbd3`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/2a3bbd3267e1ce9a413eba4a30757e92ee8fa87b)]:
  - @ixo/oracles-chain-client@1.1.0
  - @ixo/common@1.1.0
  - @ixo/matrix@1.1.0

## 0.1.14

### Patch Changes

- [#53](https://github.com/ixoworld/ixo-oracles-boilerplate/pull/53) [`0a4a5a8`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/0a4a5a84194acb851e3824e0b74eea54f60c8257) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - Upgrade packages and publish events package and preformance upgrades

- Updated dependencies [[`b723472`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/b72347286054e037436a8be3da3cf840f75223ca), [`0a4a5a8`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/0a4a5a84194acb851e3824e0b74eea54f60c8257)]:
  - @ixo/matrix@1.0.2
  - @ixo/oracles-chain-client@1.0.15
  - @ixo/data-store@1.0.1
  - @ixo/common@1.0.2
  - @ixo/oracles-events@1.0.1

## 0.1.10

### Patch Changes

- [#15](https://github.com/ixoworld/companion/pull/15) [`9addc39`](https://github.com/ixoworld/companion/commit/9addc39944d2c962d72c1dcda77dba64e069c7c4) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - Companion

## 0.1.9

### Patch Changes

- [#10](https://github.com/ixoworld/companion/pull/10) [`71ba646`](https://github.com/ixoworld/companion/commit/71ba6468d43903f7b8e0eed1ce7d85a8f42c920b) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - remove queue

## 0.1.8

### Patch Changes

- [#7](https://github.com/ixoworld/companion/pull/7) [`3c6d704`](https://github.com/ixoworld/companion/commit/3c6d704eb2d6f9e68d90dd13891afb8f0fec5c07) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - remvoe redis

## 0.1.7

### Patch Changes

- [#5](https://github.com/ixoworld/companion/pull/5) [`47f961d`](https://github.com/ixoworld/companion/commit/47f961d9d88cfc88af03a67a56f326040e519680) Thanks [@LukePetzer-ixo](https://github.com/LukePetzer-ixo)! - init

## 0.1.6

### Patch Changes

- [#44](https://github.com/ixoworld/ixo-oracles-boilerplate/pull/44) [`2b93cf8`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/2b93cf8ef3839c36f03249b9392606211a22a0db) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - use matrix spaces and reduce using user mx token

- Updated dependencies [[`2b93cf8`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/2b93cf8ef3839c36f03249b9392606211a22a0db)]:
  - @ixo/oracles-chain-client@1.0.13
  - @ixo/common@1.0.1
  - @ixo/matrix@1.0.1

## 0.1.5

### Patch Changes

- Updated dependencies [[`e4c8f86`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/e4c8f866f6a51716e0c2074c9fe54d76beb4e92f)]:
  - @ixo/oracles-chain-client@1.0.12

## 0.1.4

### Patch Changes

- Updated dependencies [[`da24aae`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/da24aae97260c4fa186d3a2cc8f797c731d9cb98)]:
  - @ixo/oracles-chain-client@1.0.11

## 0.1.3

### Patch Changes

- Updated dependencies [[`c56f5c0`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/c56f5c0aff5867e300a7008c480bd76abd68557e)]:
  - @ixo/oracles-chain-client@1.0.10

## 0.1.2

### Patch Changes

- Updated dependencies [[`267de8c`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/267de8c8065387f69ae882920e101331fb93d2dd)]:
  - @ixo/oracles-chain-client@1.0.9

## 0.1.1

### Patch Changes

- Updated dependencies [[`edc19e3`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/edc19e39da21347af70f71432b297a6bfb135435)]:
  - @ixo/oracles-chain-client@1.0.8

## 0.1.0

### Minor Changes

- [#25](https://github.com/ixoworld/ixo-oracles-boilerplate/pull/25) [`407a565`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/407a56560545b6e259a9d384efef6717b5050cab) Thanks [@Michael-Ixo](https://github.com/Michael-Ixo)! - Fixes for dockerfile

## 0.0.8

### Patch Changes

- Updated dependencies [[`bdff5e0`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/bdff5e0fdee1b52bbdd84f6c68d6cd6679b9c05d)]:
  - @ixo/oracles-chain-client@1.0.7

## 0.0.7

### Patch Changes

- Updated dependencies [[`6505d49`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/6505d4907e0a0f27656a72e5f334cfeba08a22b9)]:
  - @ixo/oracles-chain-client@1.0.6

## 0.0.6

### Patch Changes

- Updated dependencies [[`c050676`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/c050676976a8f2bf90d9ecc55be115614639c253)]:
  - @ixo/oracles-chain-client@1.0.5

## 0.0.5

### Patch Changes

- Updated dependencies [[`53d6155`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/53d61558d5054d74288b38d4af47a60d15a066a6)]:
  - @ixo/oracles-chain-client@1.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [[`b877474`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/b877474ee6d45e211212df15fbea337b338b8850)]:
  - @ixo/oracles-chain-client@1.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [[`26d8444`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/26d84448ac92b038df0330758f978d6be352b115)]:
  - @ixo/oracles-chain-client@1.0.2

## 0.0.2

### Patch Changes

- Updated dependencies [[`745991a`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/745991a3fc7fb9ac640dc6fd2aad5a17781df9b7)]:
  - @ixo/oracles-chain-client@1.0.1
