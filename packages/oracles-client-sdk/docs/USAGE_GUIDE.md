# Usage Guide

Complete guide to building AI-powered applications with the IXO Oracles Client SDK.

## Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [Authentication](#authentication)
- [Chat Basics](#chat-basics)
- [Rendering Messages](#rendering-messages)
- [Custom UI Components](#custom-ui-components)
- [Streaming](#streaming)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Installation

Install the SDK using your preferred package manager:

```bash
npm install @ixo/oracles-client-sdk
# or
pnpm add @ixo/oracles-client-sdk
# or
yarn add @ixo/oracles-client-sdk
```

### Peer Dependencies

The SDK requires React 18+:

```bash
npm install react@^18.0.0
```

## Setup

### 1. Wrap Your App with OraclesProvider

The `OraclesProvider` provides context for all oracle operations:

```tsx
import { OraclesProvider } from '@ixo/oracles-client-sdk';

function App() {
  return (
    <OraclesProvider
      initialWallet={{
        address: 'ixo1...',
        did: 'did:ixo:entity:...',
        matrix: { accessToken: 'syt_...' },
      }}
      transactSignX={async (messages, memo) => {
        // Sign blockchain transactions here
        // Return transaction result or undefined
        return undefined;
      }}
    >
      <YourApp />
    </OraclesProvider>
  );
}
```

### 2. Configuration Options

| Option          | Type       | Required | Description                  |
| --------------- | ---------- | -------- | ---------------------------- |
| `initialWallet` | `IWallet`  | Yes      | User's wallet information    |
| `transactSignX` | `function` | Yes      | Transaction signing function |

## Authentication

The SDK handles authentication automatically using Matrix access tokens.

### Getting OpenID Token

```tsx
import { useGetOpenIdToken } from '@ixo/oracles-client-sdk';

function Component() {
  const { openIdToken, isLoading } = useGetOpenIdToken();

  if (isLoading) return <div>Authenticating...</div>;
  if (!openIdToken) return <div>Authentication failed</div>;

  return <div>Authenticated!</div>;
}
```

### Manual Token Retrieval

```tsx
import { getOpenIdToken } from '@ixo/oracles-client-sdk';

const token = await getOpenIdToken(matrixClient);
```

## Chat Basics

### Creating and Managing Sessions

Sessions represent individual conversations with an oracle:

```tsx
import { useOracleSessions } from '@ixo/oracles-client-sdk';

function ChatApp() {
  const oracleDid = 'did:ixo:entity:your-oracle';

  const { sessions, createSession, deleteSession, isLoading } =
    useOracleSessions(oracleDid);

  const handleNewChat = async () => {
    const newSession = await createSession();
    console.log('Created session:', newSession.sessionId);
  };

  return (
    <div>
      <button onClick={handleNewChat}>New Chat</button>

      {sessions?.map((session) => (
        <div key={session.sessionId}>
          <p>Session: {session.sessionId}</p>
          <button onClick={() => deleteSession(session.sessionId)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Using the Chat Hook

The `useChat` hook provides complete chat functionality:

```tsx
import { useChat, renderMessageContent } from '@ixo/oracles-client-sdk';

function Chat({ oracleDid, sessionId }) {
  const {
    messages, // Array of messages
    sendMessage, // Function to send messages
    isSending, // Loading state
    isLoading, // Initial data loading
    error, // Error state
    refetchMessages, // Refetch messages manually
    isRealTimeConnected, // WebSocket/SSE connection status
  } = useChat({
    oracleDid,
    sessionId,
    onPaymentRequiredError: (claimIds) => {
      // Handle payment requirements
      console.log('Payment required for claims:', claimIds);
    },
  });

  if (isLoading) return <div>Loading chat...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {/* Connection indicator */}
      <div>
        Status: {isRealTimeConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>

      {/* Messages */}
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.type}>
            {renderMessageContent(msg.content)}
          </div>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.message;
          sendMessage(input.value);
          input.value = '';
        }}
      >
        <input name="message" disabled={isSending} />
        <button type="submit" disabled={isSending}>
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

### Streaming Modes

Control how streaming updates are handled for different use cases:

```tsx
// Real-time streaming - immediate updates as they arrive (default)
const { messages } = useChat({
  oracleDid,
  sessionId,
  streamingMode: 'immediate', // or omit for default behavior
  onPaymentRequiredError: handlePayment,
});

// Batched streaming - optimized for performance
const { messages } = useChat({
  oracleDid,
  sessionId,
  streamingMode: 'batched', // Updates batched at ~60fps
  onPaymentRequiredError: handlePayment,
});
```

**When to use each mode:**

- **`immediate`** (default): Live typing effects, real-time collaboration, when you want users to see text appearing character by character
- **`batched`**: High-volume streaming, mobile devices, when performance is more important than visual smoothness

### Sending Messages with Metadata

Attach custom metadata to messages:

```tsx
await sendMessage('Hello', {
  source: 'mobile',
  timestamp: Date.now(),
  userContext: { mood: 'happy' },
});
```

## Rendering Messages

Messages are stored as **plain data** (not React elements) for performance. Use `renderMessageContent` to transform them into UI.

### Basic Rendering

```tsx
import { renderMessageContent } from '@ixo/oracles-client-sdk';

function MessageList({ messages }) {
  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id} className={msg.type}>
          {/* Automatically handles strings and components */}
          {renderMessageContent(msg.content)}
        </div>
      ))}
    </div>
  );
}
```

### Message Content Types

Messages can contain three types of content:

1. **String** - Plain text
2. **Component Metadata** - Custom UI component data
3. **Array** - Mix of strings and components

```typescript
// String content
{
  id: 'msg-1',
  content: 'Hello world',
  type: 'human'
}

// Component metadata
{
  id: 'msg-2',
  content: {
    name: 'WeatherWidget',
    props: { city: 'New York', temp: 72 }
  },
  type: 'ai'
}

// Mixed array
{
  id: 'msg-3',
  content: [
    'Here is the weather:',
    {
      name: 'WeatherWidget',
      props: { city: 'New York', temp: 72 }
    }
  ],
  type: 'ai'
}
```

## Custom UI Components

Register custom React components to render rich, interactive content from the AI.

### Defining Components

Create components that accept specific props:

```tsx
// components/WeatherWidget.tsx
interface WeatherProps {
  city: string;
  temperature: number;
  condition: string;
  isLoading?: boolean;
}

export function WeatherWidget({
  city,
  temperature,
  condition,
  isLoading,
}: WeatherProps) {
  if (isLoading) {
    return <div>Loading weather for {city}...</div>;
  }

  return (
    <div className="weather-widget">
      <h3>{city}</h3>
      <div className="temp">{temperature}°C</div>
      <div className="condition">{condition}</div>
    </div>
  );
}
```

### Registering Components

Pass components to `useChat`:

```tsx
import { WeatherWidget } from './components/WeatherWidget';
import { PriceChart } from './components/PriceChart';

function Chat({ oracleDid, sessionId }) {
  const { messages, sendMessage } = useChat({
    oracleDid,
    sessionId,
    // Register your custom components
    uiComponents: {
      WeatherWidget,
      PriceChart,
      // Add more components as needed
    },
    onPaymentRequiredError: () => {},
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          {/* Components are automatically rendered when referenced */}
          {renderMessageContent(msg.content, uiComponents)}
        </div>
      ))}
    </div>
  );
}
```

### Component Props Convention

All custom components receive standard props:

- `isLoading?: boolean` - True while component data is streaming
- `id: string` - Unique identifier
- Custom props from your component definition

## Streaming

Messages stream in real-time with optimized performance.

### How Streaming Works

1. User sends a message
2. AI response streams chunk by chunk
3. Each chunk triggers a state update
4. RAF batching prevents excessive re-renders
5. Final message is persisted

### Performance Characteristics

- Smooth 60fps even at 100+ chunks/second
- RAF batching coalesces rapid updates
- Minimal memory allocations
- ~75% less CPU than naive implementations

### Monitoring Streaming State

```tsx
const { isSending, status } = useChat({
  oracleDid,
  sessionId,
  onPaymentRequiredError: () => {},
});

// status can be: 'ready' | 'submitted' | 'streaming' | 'error'
console.log('Chat status:', status);
console.log('Is sending:', isSending);
```

## Error Handling

### Common Errors

#### Payment Required

```tsx
const { sendMessage } = useChat({
  oracleDid,
  sessionId,
  onPaymentRequiredError: (claimIds) => {
    // Show payment modal
    alert(`Please complete payment for claims: ${claimIds.join(', ')}`);

    // Use useContractOracle to handle payment
  },
});
```

#### Connection Errors

```tsx
const { error, isRealTimeConnected } = useChat({
  oracleDid,
  sessionId,
  onPaymentRequiredError: () => {},
});

if (error) {
  return (
    <div className="error">
      <h3>Error</h3>
      <p>{error.message}</p>
      <button onClick={() => refetchMessages()}>Retry</button>
    </div>
  );
}

if (!isRealTimeConnected) {
  return <div className="warning">Reconnecting...</div>;
}
```

#### Session Errors

```tsx
const { error, createSession } = useOracleSessions(oracleDid);

if (error) {
  return (
    <div>
      <p>Failed to load sessions: {error.message}</p>
      <button onClick={() => createSession()}>Create New Session</button>
    </div>
  );
}
```

## Best Practices

### 1. Always Use renderMessageContent

```tsx
// ✅ Correct
{
  messages.map((msg) => (
    <div key={msg.id}>{renderMessageContent(msg.content, uiComponents)}</div>
  ));
}

// ❌ Wrong - won't render components
{
  messages.map((msg) => <div key={msg.id}>{msg.content}</div>);
}
```

### 2. Memoize UI Components

```tsx
const uiComponents = useMemo(
  () => ({
    WeatherWidget,
    PriceChart,
  }),
  [],
); // Don't recreate on every render
```

### 3. Handle Loading States

```tsx
if (isLoading) return <Skeleton />;
if (!sessionId) return <div>Create a session to start</div>;
```

### 4. Optimize Re-renders

```tsx
// Wrap message rendering in memo if list is large
const Message = memo(({ message, uiComponents }) => (
  <div className={message.type}>
    {renderMessageContent(message.content, uiComponents)}
  </div>
));

function MessageList({ messages, uiComponents }) {
  return (
    <div>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} uiComponents={uiComponents} />
      ))}
    </div>
  );
}
```

## Next Steps

- [API Reference](./API_REFERENCE.md) - Complete API documentation
- [Examples](./EXAMPLES.md) - Practical code examples
- [Live Agent Guide](./LIVE_AGENT.md) - Voice & video calls
