# Services Documentation

## Overview

The Services module in `@ixo/common` provides essential services for managing Matrix rooms and chat sessions. It integrates with the Matrix protocol through `@ixo/matrix` and provides type-safe operations for room and session management.

## Core Services

### Room Manager Service

A service for managing Matrix rooms with support for creation, retrieval, and access control.

```typescript
import { RoomManagerService } from '@ixo/common/services';

const roomManager = new RoomManagerService();

// Create or get existing room
const roomId = await roomManager.getOrCreateRoom({
  did: 'user-did',
  oracleName: 'oracle-name',
  userAccessToken: 'matrix-access-token',
});

// Get room by DID and oracle name
const room = await roomManager.getRoom({
  did: 'user-did',
  oracleName: 'oracle-name',
});
```

#### Room Manager Capabilities

- Create new Matrix rooms
- Retrieve existing rooms by DID and oracle name
- Get or create rooms (idempotent operation)

#### Room Manager Types

```typescript
interface CreateRoomDto {
  did: string;
  oracleName: string;
  userAccessToken: string;
}

interface GetRoomDto {
  did: string;
  oracleName: string;
}
```

### Session Manager Service

A service for managing chat sessions with support for persistence in Matrix rooms.

```typescript
import { SessionManagerService } from '@ixo/common/services';

const sessionManager = new SessionManagerService();

// Create new chat session
const session = await sessionManager.createSession({
  did: 'user-did',
  oracleName: 'oracle-name',
  matrixAccessToken: 'access-token',
});

// List user's sessions
const { sessions } = await sessionManager.listSessions({
  did: 'user-did',
  matrixAccessToken: 'access-token',
});

// Delete a session
await sessionManager.deleteSession({
  did: 'user-did',
  sessionId: 'session-uuid',
  matrixAccessToken: 'access-token',
});
```

#### Session Manager Capabilities

- Create new chat sessions
- List existing sessions for a user
- Delete sessions
- Automatic session title generation using AI
- Session state persistence in Matrix rooms
- Type-safe operations with DTOs

#### Session Types

```typescript
interface ChatSession {
  sessionId: string;
  oracleName: string;
  title: string;
  lastUpdatedAt: string;
  createdAt: string;
}

interface CreateChatSessionDto {
  did: string;
  oracleName: string;
  matrixAccessToken: string;
}

interface ListChatSessionsDto {
  did: string;
  matrixAccessToken: string;
}

interface DeleteChatSessionDto {
  did: string;
  sessionId: string;
  matrixAccessToken: string;
}
```

## Error Handling

The services provide specific error types for common scenarios:

```typescript
import {
  NoUserRoomsFoundError,
  RoomNotFoundError,
  UserNotInRoomError,
} from '@ixo/common/services';

try {
  await operation();
} catch (error) {
  if (error instanceof NoUserRoomsFoundError) {
    // Handle case where user has no rooms
  } else if (error instanceof RoomNotFoundError) {
    // Handle case where specific room not found
  } else if (error instanceof UserNotInRoomError) {
    // Handle case where user doesn't have access
  }
}
```

## Integration with Matrix

Both services integrate with the Matrix protocol through `@ixo/matrix`:

- Uses Matrix rooms for persistence
- Leverages Matrix state events for session storage
- Handles Matrix authentication and access control
- Provides type-safe Matrix operations

## Best Practices

### Room Management

- Store room IDs for frequent access
- Handle room creation idempotently
- Validate user access tokens
- Use appropriate error handling

### Session Management

- Use UUIDs for session IDs
- Handle session state updates atomically
- Implement proper cleanup for deleted sessions
- Validate session access before operations
