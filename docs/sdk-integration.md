# @ixo/oracles-client-sdk React Integration Guide

A practical guide for integrating the `@ixo/oracles-client-sdk` into React applications.

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Provider Configuration](#provider-configuration)
3. [Core Hooks](#core-hooks)
4. [Complete Example](#complete-example)
5. [Advanced Features](#advanced-features)

## Installation & Setup

### Installing the Package

```bash
npm install @ixo/oracles-client-sdk
# or
yarn add @ixo/oracles-client-sdk
# or
pnpm add @ixo/oracles-client-sdk
```

### Basic Import

```typescript
import {
  OraclesProvider,
  useChat,
  useOracleSessions,
  useContractOracle,
  useMemoryEngine,
} from '@ixo/oracles-client-sdk';
```

## Provider Configuration

### OraclesProvider Setup

The `OraclesProvider` must wrap your application to provide oracle functionality to child components.

```typescript
import { OraclesProvider } from "@ixo/oracles-client-sdk";

function App() {
  return (
    <OraclesProvider
      apiKey=""  // Your API key
      initialWallet={{
        address: "ixo1...", // Wallet address
        did: "did:ixo:entity:...", // DID identifier
        matrix: {
          accessToken: "syt_..." // Matrix access token
        }
      }}
      transactSignX={async (messages, memo) => {
        // Handle transaction signing
        // Return transaction result or undefined
        await handleTransaction(messages, memo);
        return undefined;
      }}
    >
      {/* Your app components */}
    </OraclesProvider>
  );
}
```

**Required Props:**

- `apiKey` - Your oracle API key
- `initialWallet` - Wallet configuration with address, DID, and Matrix access token
- `transactSignX` - Function to handle transaction signing

## Core Hooks

### useChat Hook

Manages chat sessions with real-time messaging and streaming responses.

```typescript
const {
  sendMessage,
  isSending,
  isLoading,
  messages,
  error,
  isRealTimeConnected,
  status,
} = useChat({
  oracleDid: 'did:ixo:entity:...',
  sessionId: 'session-id-here',
  onPaymentRequiredError: (claimIds) => {
    // Handle payment required - show payment UI
    console.log('Payment required for claims:', claimIds);
  },
});

// Send a message
await sendMessage('Hello oracle!', {
  foo: 'optional metadata',
});
```

**Key Features:**

- Real-time streaming responses
- Automatic message history
- Payment error handling
- Custom UI components support
- Browser tools integration

### useOracleSessions Hook

Create and manage chat sessions.

```typescript
const { createSession, deleteSession, sessions, isLoading, isCreatingSession } =
  useOracleSessions(oracleDid);

// Create new session
const newSession = await createSession();

// Delete session
await deleteSession(sessionId);
```

### useContractOracle Hook

Handle oracle authorization and payments.

```typescript
import { useContractOracle } from "@ixo/oracles-client-sdk";

function ContractComponent() {
  const {
    authzConfig,
    pricingList,
    isLoadingAuthzConfig,
    isLoadingPricingList,
    contractOracle,
    payClaim,
    isContractingOracle,
    isPayingClaim
  } = useContractOracle({
    params: {
      // all this values are coming from the user subscription details
      oracleDid: "did:ixo:entity:...",
      userClaimCollectionId: "collection-id",
      adminAddress: "ixo1admin...",
      claimId: "claim-id", // optional - if you have payment error from the call back u should pass the claim id here so the `payClaim` function can pay the claim
      agentQuota: 100,
      maxAmount: {
        amount: 10, // or what ever the user selects from the pricing list
        denom: "uixo"
      }

    }
  });

// Contract with oracle (authorize)
await contractOracle();

// Pay for a specific claim
await payClaim();
```

### useMemoryEngine Hook

Enable persistent context across sessions (optional).

```typescript
const { enableMemoryEngine, members, isLoadingMemoryEngine } =
  useMemoryEngine(oracleDid);

const memoryEngineUserId = process.env.REACT_APP_MEMORY_ENGINE_USER_ID;
const isEnabled = members?.includes(memoryEngineUserId || '');

// Enable memory engine
await enableMemoryEngine(memoryEngineUserId);
```

## Complete Example

```typescript
import React, { useState, useEffect } from "react";
import {
  OraclesProvider,
  useChat,
  useOracleSessions
} from "@ixo/oracles-client-sdk";

function App() {
  return (
    <OraclesProvider
      apiKey="your-api-key"
      initialWallet={{
        address: "ixo1...",
        did: "did:ixo:entity:...",
        matrix: { accessToken: "syt_..." }
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
  const [selectedSession, setSelectedSession] = useState(null);
  const [message, setMessage] = useState("");

  // Sessions
  const { createSession, sessions, isLoading: isSessionsLoading } = useOracleSessions(oracleDid);

  // Chat
  const { sendMessage, isSending, messages } = useChat({
    oracleDid,
    sessionId: selectedSession?.sessionId || "",
    onPaymentRequiredError: (claimIds) => {
      // Show payment UI
      alert(`Payment required: ${claimIds.join(", ")}`);
    }
  });

  // Auto-select first session
  useEffect(() => {
    if (sessions && sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0]);
    }
  }, [sessions, selectedSession]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    await sendMessage(message);
    setMessage("");
  };

  return (
    <div>
      {/* Sessions */}
      <button onClick={() => createSession()}>New Session</button>
      {sessions?.map((session) => (
        <button key={session.sessionId} onClick={() => setSelectedSession(session)}>
          {session.title}
        </button>
      ))}

      {/* Chat */}
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.type}:</strong> {msg.content}
          </div>
        ))}
      </div>

      {/* Input */}
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
      />
      <button onClick={handleSendMessage} disabled={isSending}>
        Send
      </button>
    </div>
  );
}
```

## Advanced Features

### Custom UI Components

```typescript
// Custom tool call component
function CustomToolCall(props) {
  return (
    <div className={`tool-call ${props.status}`}>
      <h4>{props.toolName}</h4>
      {props.isLoading && <div>Loading...</div>}
      {props.output && <pre>{props.output}</pre>}
    </div>
  );
}

// Use in chat
const { ... } = useChat({
  // ...other props
  uiComponents: {
    toolCall: CustomToolCall
  }
});
```

### Browser Tools

```typescript
import { z } from "zod";

const browserTools = {
  getCurrentTime: {
    toolName: "getCurrentTime",
    description: "Get the current time",
    schema: z.object({
      timezone: z.string().optional()
    }),
    fn: async (args) => {
      return new Date().toLocaleString();
    }
  }
};

const { ... } = useChat({
  // ...other props
  browserTools
});
```

### Error Handling

```typescript
const handleSendMessage = async () => {
  try {
    await sendMessage(message);
  } catch (error) {
    if (error.message.includes('PAYMENT_REQUIRED')) {
      // Show payment UI
    } else {
      console.error('Error:', error);
    }
  }
};
```

### Performance Tips

- Memoize expensive components with `React.memo()`
- Use loading states for better UX
- Handle real-time connection status
- Auto-select first session when available

For complete TypeScript interfaces and more examples, see the package exports and inline documentation.
