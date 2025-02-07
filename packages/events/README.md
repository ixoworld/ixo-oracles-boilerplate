# `@ixo/oracles-events`

**Table of Contents**

- [Overview](#overview)
- [When Should You Use an Event?](#when-should-you-use-an-event)
- [Installation](#installation)
- [Creating a New Event](#creating-a-new-event)
  - [1. Extend the BaseEvent Class](#1-extend-the-baseevent-class)
  - [2. Register the Event in GraphEventEmitter](#2-register-the-event-in-grapheventemitter)
  - [3. Emit the Event](#3-emit-the-event)
- [Core Events](#core-events)
- [Testing](#testing)
- [Contributing](#contributing)

---

## Overview

The `@ixo/oracles-events` package provides a robust, event-driven system for real-time communication throughout the ixo Oracles platform. It uses a combination of `EventEmitter2` for internal event handling and `socket.io` for WebSocket-based client communication.

Key features:

- Type-safe event payloads with TypeScript
- Automatic WebSocket broadcasting to connected clients
- Required session tracking via `connectionId`, `sessionId`, and `requestId`
- Server-side only implementation (browser usage is prevented)

---

## When Should You Use an Event?

Events are ideal for:

1. **Cross-Service Communication**: When different services need to react to changes or actions
2. **Real-time Updates**: Pushing updates to connected WebSocket clients
3. **Loose Coupling**: Keeping services independent while allowing them to interact
4. **State Change Notifications**: Broadcasting important state changes across the system

---

## Installation

```bash
pnpm install @ixo/oracles-events
```

---

## Creating a New Event

### 1. Extend the BaseEvent Class

Create a new event by extending `BaseEvent` with your payload type:

```typescript
import { BaseEvent, WithRequiredEventProps } from '@ixo/oracles-events';

interface IMyCustomEventPayload {
  message: string;
  // Add any custom payload properties
}

export class MyCustomEvent extends BaseEvent<IMyCustomEventPayload> {
  static readonly eventName = 'my.custom.event';
  public readonly eventName = MyCustomEvent.eventName;

  constructor(public payload: WithRequiredEventProps<IMyCustomEventPayload>) {
    super();
  }
}
```

**Required Payload Properties**
Every event payload must include:

- `connectionId`: Identifies the WebSocket connection
- `sessionId`: Identifies the chat session
- `requestId`: Identifies the specific request within a session

### 2. Register the Event in GraphEventEmitter

Register your event in `graph-event-emitter.ts`:

```typescript
import { Socket } from 'socket.io';
import { MyCustomEvent } from './events/my-custom.event';

export class GraphEventEmitter {
  static registerEventHandlers(server: Socket): void {
    MyCustomEvent.registerEventHandlers(server);
    // Register other events...
  }
}
```

### 3. Emit the Event

Emit your event from any server-side code:

```typescript
const event = new MyCustomEvent({
  connectionId: 'ws-connection-id',
  sessionId: 'chat-session-id',
  requestId: 'message-request-id',
  message: 'Hello from custom event!',
});

event.emit();
```

---

## Core Events

The package includes several core events:

- **RouterEvent**: Navigation and routing state changes
- **ToolCallEvent**: Tool/microservice invocation tracking
- **RenderComponentEvent**: UI update instructions
- **MessageCacheInvalidationEvent**: Cache invalidation signals

Each core event is designed for a specific use case and follows the same pattern as custom events.

---

## Testing

The package provides test utilities in `test-utils.ts` to help test event implementations:

```typescript
import { createTestEvent } from '@ixo/oracles-events/test-utils';

describe('MyCustomEvent', () => {
  it('should emit with correct payload', () => {
    const event = createTestEvent(MyCustomEvent, {
      message: 'test message',
    });
    // Add your test assertions
  });
});
```

---

## Contributing

To contribute:

1. Ensure your event extends `BaseEvent`
2. Include proper TypeScript types for your payload
3. Add test coverage using the provided test utilities
4. Follow the existing pattern for event registration
5. Submit a PR with your changes

**Important Notes**:

- Events are server-side only
- Always include required payload properties
- Use semantic event names (e.g., 'domain.action.event')

---

**Thank you for using `@ixo/oracles-events`!**
