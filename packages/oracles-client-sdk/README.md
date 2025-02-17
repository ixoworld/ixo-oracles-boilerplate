# @ixo/oracles-client-sdk

A React SDK for integrating with the IXO Oracles platform. This SDK provides components and hooks for real-time communication with oracles, managing chat sessions, and handling messages.

---

## Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [Session Management](#session-management)
- [Message Management](#message-management)
- [Dynamic UI Components](#dynamic-ui-components)
- [Building Components](#building-components)
- [Platform Support](#platform-support)

---

## Installation

```bash
# Using npm
npm install @ixo/oracles-client-sdk

# Using yarn
yarn add @ixo/oracles-client-sdk

# Using pnpm
pnpm add @ixo/oracles-client-sdk
```

---

## Setup

Wrap your application with the `OraclesProvider` component:

```tsx
import { OraclesProvider } from '@ixo/oracles-client-sdk';

function App() {
  return (
    <OraclesProvider
      apiUrl="YOUR_API_URL"
      apiKey="YOUR_API_KEY"
      config={{
        did: 'YOUR_DID',
        matrixAccessToken: 'YOUR_MATRIX_TOKEN',
      }}
    >
      {/* Your app components */}
    </OraclesProvider>
  );
}
```

### OraclesProvider Props

| Prop                  | Type        | Required | Description                          |
| --------------------- | ----------- | -------- | ------------------------------------ |
| `apiUrl`              | string      | Yes      | The URL of the oracles API           |
| `apiKey`              | string      | Yes      | Your API key for authentication      |
| `config`              | object      | Yes      | Configuration object (see below)     |
| `overrideQueryClient` | QueryClient | No       | Optional React Query client override |

#### Config Object

| Property            | Type   | Description                            |
| ------------------- | ------ | -------------------------------------- |
| `did`               | string | Your DID identifier                    |
| `matrixAccessToken` | string | Matrix access token for authentication |

---

## Session Management

The SDK provides hooks for managing chat sessions with oracles.

### `useSessions()`

Retrieves all chat sessions. Returns a React Query result with sessions data.

```tsx
import { useSessions } from '@ixo/oracles-client-sdk';

function SessionsList() {
  const { data, isLoading, error } = useSessions();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.sessions.map((session) => (
        <li key={session.sessionId}>
          {session.title} - {session.oracleName}
        </li>
      ))}
    </ul>
  );
}
```

### `useCreateSession()`

Creates a new chat session with an oracle.

```tsx
import { useCreateSession } from '@ixo/oracles-client-sdk';

function CreateSession() {
  const { createSession, isLoading, error } = useCreateSession();

  const handleCreate = () => {
    createSession();
  };

  return (
    <button onClick={handleCreate} disabled={isLoading}>
      Create New Session
    </button>
  );
}
```

### `useDeleteSession()`

Deletes an existing chat session.

```tsx
import { useDeleteSession } from '@ixo/oracles-client-sdk';

function DeleteSession({ sessionId }) {
  const { deleteSession, isLoading, error } = useDeleteSession();

  return (
    <button onClick={() => deleteSession({ sessionId })} disabled={isLoading}>
      Delete Session
    </button>
  );
}
```

### `useUpdateSessionTitle()`

Updates a session's title.

```tsx
import { useUpdateSessionTitle } from '@ixo/oracles-client-sdk';

function UpdateTitle({ sessionId }) {
  const { updateSessionTitle, isLoading, error } = useUpdateSessionTitle();

  const handleUpdate = (newTitle: string) => {
    updateSessionTitle({ sessionId, title: newTitle });
  };

  return (
    <button onClick={() => handleUpdate('New Title')} disabled={isLoading}>
      Update Title
    </button>
  );
}
```

---

## Message Management

### `useListMessages()`

Retrieves messages from a specific session. Supports custom UI components for rendering different types of messages.

More information about the UI components can be found in the [Dynamic UI Components](#dynamic-ui-components) section.

```tsx
import { useListMessages } from '@ixo/oracles-client-sdk';

function MessagesList({ sessionId }) {
  const { data, isLoading, error } = useListMessages({
    sessionId,
    uiComponents: {
      // Optional custom components for rendering specific message types
      customComponent: (props) => <div {...props} />,
    },
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data.map((message) => (
        <div key={message.id}>
          <span>{message.type === 'ai' ? 'Oracle' : 'You'}: </span>
          {message.content}
        </div>
      ))}
    </div>
  );
}
```

### `useSendMessage()`

Sends messages in a session and handles real-time oracle responses. Provides optimistic updates and error handling.

```tsx
import { useSendMessage } from '@ixo/oracles-client-sdk';

function SendMessage({ sessionId }) {
  const { sendMessage, isSending, error } = useSendMessage({ sessionId });

  const handleSend = async () => {
    try {
      await sendMessage('Hello Oracle!');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div>
      <button onClick={handleSend} disabled={isSending}>
        Send Message
      </button>
      {error && <div>Error: {error.message}</div>}
    </div>
  );
}
```

---

## Dynamic UI Components

The SDK supports dynamic rendering of custom UI components in response to AI events (tool calls).

### Key Features

- **Dynamic Component Resolution**: When the AI emits a tool call (e.g., `CoinCard`), the component is automatically resolved and rendered
- **Loading State Support**: Components can handle loading states while tool calls are processing
- **Automatic Integration**: No manual component resolution needed - handled by `useListMessages`

### Integration Steps

1. **Create Your Component**

   ```tsx
   function CoinCard(props) {
     return (
       <div>
         {props.coin.name} {props.coin.symbol} {props.coin.price}
       </div>
     );
   }
   ```

2. **Add Loading Support (Optional)**

   If you want to handle the loading state of the component, you can add the following to the component:
   otherwise the library will show a loading skeleton.

   ```tsx
   CoinCard.prototype.canHandleLoadingState = true;
   ```

3. **Register Components**

   ```tsx
   const components = {
     CoinCard: CoinCard,
   };

   useListMessages({
     sessionId,
     uiComponents: components,
   });
   ```

### Example Chat Interface

check if the message is a string or a component and render it accordingly

```tsx
function ChatInterface({ messages }) {
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.type === 'human' ? 'human' : 'ai'}
          >
            {typeof message.content === 'string' ? (
              <Markdown>{message.content}</Markdown>
            ) : (
              message.content
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Building Components

### Component Requirements

1. **Props Interface**

   ```tsx
   interface ComponentProps {
     isLoading?: boolean;
     // Your component-specific props
   }
   ```

2. **Loading State Handler**

   ```tsx
   export function CustomComponent({ isLoading, ...props }: ComponentProps) {
     if (isLoading) {
       return <LoadingSkeleton />;
     }
     return <div>Component Content</div>;
   }
   ```

3. **Loading State Support Declaration**

   ```tsx
   CustomComponent.prototype.canHandleLoadingState = true;
   ```

---

## Platform Support

The SDK is platform-agnostic and works in both web and mobile environments.

### Web (React DOM)

```tsx
function WebChat() {
  return (
    <div className="chat">
      <MessageList />
      <input type="text" />
      <button>Send</button>
    </div>
  );
}
```

### Mobile (React Native)

```tsx
function MobileChat() {
  return (
    <View style={styles.chat}>
      <MessageList />
      <TextInput />
      <TouchableOpacity>
        <Text>Send</Text>
      </TouchableOpacity>
    </View>
  );
}
```
