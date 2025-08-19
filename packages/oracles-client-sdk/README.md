# @ixo/oracles-client-sdk

A React SDK for integrating with IXO Oracles. This package provides hooks and components for building oracle-powered applications with real-time chat, session management, and blockchain integration.

## 🚀 Quick Start

### Installation

```bash
npm install @ixo/oracles-client-sdk
# or
pnpm add @ixo/oracles-client-sdk
```

### Basic Setup

```tsx
import {
  OraclesProvider,
  useChat,
  useOracleSessions,
} from '@ixo/oracles-client-sdk';

function App() {
  return (
    <OraclesProvider
      apiKey="your-api-key"
      initialWallet={{
        address: 'ixo1...',
        did: 'did:ixo:entity:...',
        matrix: { accessToken: 'syt_...' },
      }}
      transactSignX={async (messages, memo) => {
        // Handle transaction signing
        return undefined;
      }}
    >
      <OracleChat oracleDid="did:ixo:entity:oracle-did" />
    </OraclesProvider>
  );
}

function OracleChat({ oracleDid }) {
  const { createSession, sessions } = useOracleSessions(oracleDid);
  const { sendMessage, messages, isSending } = useChat({
    oracleDid,
    sessionId: sessions?.[0]?.sessionId || '',
    onPaymentRequiredError: (claimIds) => {
      console.log('Payment required:', claimIds);
    },
  });

  return (
    <div>
      <button onClick={() => createSession()}>New Session</button>
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>{msg.content}</div>
        ))}
      </div>
      <button onClick={() => sendMessage('Hello oracle!')} disabled={isSending}>
        Send Message
      </button>
    </div>
  );
}
```

## 📚 Documentation

For comprehensive documentation including:

- Complete API reference
- Advanced usage patterns
- TypeScript interfaces
- Implementation examples
- Best practices

See: [React Integration Guide](../../docs/sdk-integration.md)

## 🔧 Core Features

- **Real-time Chat**: WebSocket and SSE support for live conversations
- **Session Management**: Create, manage, and delete oracle sessions
- **Payment Integration**: Handle oracle payments and authorization
- **Memory Engine**: Optional persistent context across sessions
- **Custom UI Components**: Extensible UI component system
- **TypeScript**: Full type safety and IntelliSense support

## 📖 API Overview

### Hooks

- `useChat` - Main chat functionality with real-time messaging
- `useOracleSessions` - Session creation and management
- `useContractOracle` - Oracle authorization and payments
- `useMemoryEngine` - Optional memory engine integration

### Components

- `OraclesProvider` - Required context provider for all oracle functionality

## 🛠️ Development

```bash
# Build the package
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm dev
```

## 📄 License

Internal package - All rights reserved.
