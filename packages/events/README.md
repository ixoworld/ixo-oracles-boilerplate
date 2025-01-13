Below is an example of a more structured documentation (e.g., a README) that explains **what** this package does, **why** and **when** you should use events, and **how** to create and manage new events. Feel free to adapt it to fit your specific needs.

---

# `@ixo/oracles-events`

**Table of Contents**  
- [Overview](#overview)  
- [When Should You Use an Event?](#when-should-you-use-an-event)  
- [Installation](#installation)  
- [Creating a New Event](#creating-a-new-event)  
  - [1. Extend the BaseEvent Class](#1-extend-the-baseevent-class)  
  - [2. Register the Event in `GraphEventEmitter`](#2-register-the-event-in-grapheventemitter)  
  - [3. Emit the Event](#3-emit-the-event)  
- [Predefined Events](#predefined-events)  
- [Testing](#testing)  
- [Contributing](#contributing)  

---

## Overview

The `@ixo/oracles-events` package provides a robust, event-driven system to facilitate real-time communication throughout the ixo Oracles platform. By leveraging `eventemitter2` and WebSocket connections via `socket.io`, modules can send and receive events seamlessly across services or between the backend and frontend.

Event-driven architecture helps **decouple** your modules. Instead of a module having to call another module’s function directly, it can emit an event. Any module that cares about this event can listen for it and act accordingly. This approach results in cleaner, more maintainable code where modules don’t need to know about each other’s internals.

---

## When Should You Use an Event?

Use an event when you:

1. **Need to notify other parts of the system or external services** that something has happened (e.g., data changed, request fulfilled, user action completed).  
2. **Want to trigger real-time UI updates** in front-end clients without complex polling logic.  
3. **Desire to keep modules loosely coupled**, so changes in one component (like a new feature or refactoring) don’t break functionality in other components.

---

## Installation

Install the package via:

```bash
pnpm install @ixo/oracles-events
```

---

## Creating a New Event

### 1. Extend the BaseEvent Class

Create a new class that extends `BaseEvent`. The new class should define:  
- Its **payload structure** (the data that is carried with the event).  
- The **event name** (a string that uniquely identifies your event).  

Make sure your payload includes the required properties: `connectionId`, `sessionId`, and `requestId`.

```typescript
import { BaseEvent, WithRequiredEventProps, shouldHaveConnectionId } from '@ixo/oracles-events';

interface IMyCustomEvent {
  message: string; // Additional event-specific data
}

export class MyCustomEvent extends BaseEvent<IMyCustomEvent> {
  // The payload must satisfy WithRequiredEventProps and must include connectionId, sessionId, and requestId
  constructor(public payload: WithRequiredEventProps<IMyCustomEvent>) {
    super();
    shouldHaveConnectionId(payload); // Validates the payload structure
  }

  // Unique event identifier
  public eventName = 'my.custom.event';
}
```

**Key Points**  
- `shouldHaveConnectionId(payload)` ensures the payload has the required fields.  
- `BaseEvent` provides essential logic for emitting events and registering them on the WebSocket server.

---

### 2. Register the Event in `GraphEventEmitter`

Your newly created event must be registered so that it can be transmitted via WebSockets. In your `GraphEventEmitter` class, call the event’s static `registerEventHandlers` method and pass in the Socket server.

```typescript
import { type Socket } from 'socket.io';
import { MyCustomEvent } from './events/my-custom.event';
import { RouterEvent } from './events/router.event';
import { ToolCallEvent } from './events/tool-call.event';

export class GraphEventEmitter {
  static registerEventHandlers(server: Socket): void {
    MyCustomEvent.registerEventHandlers(server);
    RouterEvent.registerEventHandlers(server);
    ToolCallEvent.registerEventHandlers(server);
    // Add any other events you want to wire up here
  }
}
```

This step ensures that whenever your event is emitted, the server knows how to handle it and can forward the event to connected clients as needed.

---

### 3. Emit the Event

Finally, you can create an instance of your event and call its `emit()` method from wherever you need in your application:

```typescript
const myEvent = new MyCustomEvent({
  connectionId: 'some-connection-id',
  sessionId: 'some-session-id',
  requestId: 'some-request-id',
  message: 'Hello, this is a custom event!',
});

myEvent.emit(); // Emit the event
```

Any client connected via `socket.io` that is listening for `"my.custom.event"` on the relevant `connectionId` will receive this payload in real time.

---

## Predefined Events

This package also comes with several **predefined events** that you can use out-of-the-box or extend for more specialized behavior.

Examples include:

- **RouterEvent:** Broadcasts routing changes across the application.  
- **ToolCallEvent:** Signals when a tool (or microservice) is invoked, enabling other components to respond or log the action.  
- **RenderComponentEvent:** Used to instruct front-end components to update or re-render.  
- **MessageCacheInvalidationEvent:** Informs the system to invalidate stale data in a message cache.

Register these events in `GraphEventEmitter` by importing and calling their `registerEventHandlers` static method, just as you would with your custom events.

---

## Testing

- **Future Testing Support:** While unit tests are not fully implemented yet, we encourage you to write tests for any new events you create.  
- **Strategy:** You can mock or spy on `rootEventEmitter` and verify that the correct event name and payload are emitted.

---

## Contributing

Contributions are welcome! To add a new event or improve existing functionality:

1. **Extend `BaseEvent`.**  
2. **Register** your new event in `GraphEventEmitter`.  
3. **Write** any necessary tests.  
4. **Submit** a Pull Request (PR) describing your changes.

We appreciate any contributions that help make this package more robust and easy to use.

---

**Thank you for using `@ixo/oracles-events`!**  

If you have questions, suggestions, or run into any issues, please open an issue on our repository or reach out via our community channels.