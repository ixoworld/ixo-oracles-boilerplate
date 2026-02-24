# Reference: State Schema

> `MainAgentGraphState` from `apps/app/src/graph/state.ts`

---

## State Fields

| Field              | Type                                | Default                                                       | Reducer                | Description                                         |
| ------------------ | ----------------------------------- | ------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| `config`           | `{ wsId?: string; did: string }`    | `{ did: '', wsId: '' }`                                       | merge                  | User identification — DID and optional WebSocket ID |
| `client`           | `'portal' \| 'matrix' \| 'slack'`   | `'portal'`                                                    | replace                | Source client type                                  |
| `messages`         | `BaseMessage[]`                     | `[]`                                                          | `messagesStateReducer` | Conversation history (LangGraph message reducer)    |
| `editorRoomId`     | `string \| undefined`               | `undefined`                                                   | replace                | Active BlockNote editor room (enables editor agent) |
| `currentEntityDid` | `string \| undefined`               | `undefined`                                                   | replace                | Context entity DID for domain-specific operations   |
| `browserTools`     | `BrowserToolCallDto[] \| undefined` | `[]`                                                          | replace                | Client-provided browser tools (reverse calls)       |
| `agActions`        | `AgActionDto[] \| undefined`        | `[]`                                                          | replace                | AG-UI custom actions from client                    |
| `userContext`      | `UserContextData`                   | `{ identity, work, goals, interests, relationships, recent }` | merge                  | Per-user personalization data from Memory Agent     |
| `mcpUcanContext`   | `MCPUCANContext \| undefined`       | `undefined`                                                   | replace                | UCAN invocations for authorized MCP tool calls      |

---

## Reducer Behaviors

- **merge** — `(prev, curr) => ({ ...prev, ...curr })` — new values override existing, unset fields preserved
- **replace** — `(_, curr) => curr` — completely replaces previous value
- **messagesStateReducer** — LangGraph's built-in message reducer, handles message appending, removal, and deduplication

---

## UserContextData

```typescript
interface UserContextData {
  identity?: string; // Who the user is
  work?: string; // What they do
  goals?: string; // What they want to achieve
  interests?: string; // What they care about
  relationships?: string; // Who they work with
  recent?: string; // Recent activity summary
}
```

Populated by the Memory Agent on each conversation turn.

---

## MCPUCANContext

```typescript
interface MCPUCANContext {
  /** Map of tool names to their serialized UCAN invocations */
  invocations: Record<string, string>;
}
```

Provided by the client SDK when invoking UCAN-protected MCP tools.
