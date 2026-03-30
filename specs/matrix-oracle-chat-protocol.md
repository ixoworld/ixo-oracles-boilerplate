# Matrix Oracle Chat Protocol — Technical Spec

**Status:** Draft v4
**Date:** 2026-03-26
**Scope:** Bring the oracle side-chat experience (tool calls, artifacts, reasoning, streaming) natively into the Matrix chat view in Portal. The SSE side-chat stays unchanged — this is about making Matrix a first-class oracle client so other clients (CLI, mobile, Slack, future Element users) get the same rich UI.

---

## 1. The Real Architecture (What We Confirmed from Code)

The oracle is **already a Matrix citizen**. It has its own Matrix user ID, is a member of each user's encrypted room, and communicates through Matrix natively:

```
User types in Matrix chat (Element, Portal matrix view, CLI)
  ↓
m.room.message → MatrixManager.onMessage() listener
  ↓
handleMessage() → debounce 500ms → flushMatrixEvents()
  ↓
sendMessage(clientType: 'matrix', msgFromMatrixRoom: true)
  ↓
mainAgent.sendMessage()  ← NON-STREAMING, synchronous today
  ↓
result.messages (complete LangGraph state)
  ↓
matrixManager.sendMessage() → posts final text back to room as m.room.message
```

**What's missing today:** Everything between "LangGraph processes" and "final text response" is invisible in Matrix. Tool calls, reasoning, artifacts, action calls — none of it reaches the Matrix room. The Portal side-chat shows all of this via SSE. We're adding it to the Matrix path.

**What we are NOT doing:** Creating an SSE/Matrix hybrid. The Portal side-chat (SSE path) is untouched. This is purely extending the Matrix client path.

---

## 2. Goals

- The Matrix chat view in Portal renders the same rich oracle experience as the side-chat panel
- Tool calls appear as they execute (live, not post-hoc)
- Artifacts (charts, tables, file previews) render inline in the Matrix timeline
- Reasoning is shown in a collapsible panel
- Custom UI components (submitClaim, etc.) render correctly
- Works across all Matrix clients that subscribe to the room
- No event storm — sensible rate of events even at 1000 concurrent users

---

## 3. Event Strategy

### What the oracle sends to the Matrix room

| Content | Matrix mechanism | Rate |
|---|---|---|
| "Oracle is thinking" | `m.typing` (oracle's Matrix user ID) | Once per turn (start/stop) |
| Tool call started | `ixo.oracle.tool_call` event | Once per tool invocation |
| Tool call completed | Edit (`m.replace`) of the tool call event | Once per tool completion |
| AG-UI action (artifact) | `ixo.oracle.action_call` event + edit | Once per action |
| Custom UI component | `ixo.oracle.render_component` event | Once per component |
| Reasoning | `ixo.oracle.reasoning` event | Once per turn (sent when complete) |
| Streaming text | Edit (`m.replace`) of first text message | Throttled: max 1 edit per 3 seconds |
| Final text | `m.room.message` (or final edit of first text) | Once per turn |

**No per-token events.** A 500-token response at 50 tokens/sec would be 50 events/sec without throttling. With 3s throttle: ~4 edits total per response. At 1000 concurrent users: ~4000 edits/min — manageable.

### What we removed from v1 spec

- `ixo.oracle.stream_chunk` — gone. Per-token events don't work at scale.
- `ixo.oracle.turn_start` — replaced by standard `m.typing`.
- `ixo.oracle.turn_end` — implicit: `m.typing` stops and final message arrives.
- SSE hybrid mode in Portal — not needed.

---

## 4. Custom Matrix Event Types

All `ixo.oracle.*` events are standard Matrix room events, fully E2E encrypted.

### 4.1 Common Envelope

Every `ixo.oracle.*` event's `content` includes:

```typescript
interface OracleEventEnvelope {
  'ixo.oracle.version': '1';
  'ixo.oracle.session_id': string;   // LangGraph thread ID (= Matrix threadId)
  'ixo.oracle.request_id': string;   // UUID per user message turn
  'ixo.oracle.turn_id': string;      // Matrix event_id of the triggering user message
}
```

`turn_id` = `event.eventId` from the incoming user `m.room.message`. Already available in `handleMessage()`.

Ordering is handled by the homeserver — the oracle is a single sender, events arrive in the order sent. No seq counter needed.

### 4.2 `ixo.oracle.tool_call`

Posted when a tool starts executing. Edited with `m.replace` when it completes.

```typescript
{
  type: 'ixo.oracle.tool_call',
  content: {
    ...OracleEventEnvelope,
    tool_call_id: string;                           // LangGraph tool call ID
    tool_name: string;                              // e.g. 'search_knowledge'
    args?: Record<string, unknown>;                 // populated on completion only
    status: 'running' | 'done' | 'error';
    output?: string;                                // populated on completion
    error?: string;
    // Signals which custom UI component to render (if any)
    'ixo.oracle.ui_component'?: string;             // e.g. 'create_page', 'create_task'
  }
}
```

**Edit flow:** Post event → save `eventId` → on tool end, send another `ixo.oracle.tool_call` event with `m.relates_to: { rel_type: 'm.replace', event_id: origEventId }` + `m.new_content: { ...updatedContent }`. Uses the existing `sendMatrixEvent()` — no new method needed.

### 4.3 `ixo.oracle.action_call`

AG-UI actions that produce artifacts (charts, tables, file previews).

```typescript
{
  type: 'ixo.oracle.action_call',
  content: {
    ...OracleEventEnvelope,
    tool_call_id: string;
    tool_name: string;                   // e.g. 'create_bar_chart', 'artifact_get_presigned_url'
    args?: Record<string, unknown>;      // chart/table spec — populated on completion
    status: 'running' | 'done' | 'error';
    result?: unknown;
    error?: string;
    // For presigned URL artifacts, store stable path here for refresh:
    'ixo.oracle.artifact_path'?: string; // e.g. '/workspace/output/report.pdf'
  }
}
```

### 4.4 `ixo.oracle.render_component`

Custom UI widgets that are not tool calls (e.g. `submitClaim` payment widget).

```typescript
{
  type: 'ixo.oracle.render_component',
  content: {
    ...OracleEventEnvelope,
    component_name: string;              // key in uiComponents registry
    props?: Record<string, unknown>;
    status: 'running' | 'done';
    event_id?: string;                   // deduplication key
  }
}
```

### 4.5 `ixo.oracle.reasoning`

The oracle's extended thinking. One event per turn, sent when reasoning is complete (not streamed).

```typescript
{
  type: 'ixo.oracle.reasoning',
  content: {
    ...OracleEventEnvelope,
    reasoning: string;                   // full reasoning text
    reasoning_details?: Array<{
      type: 'thinking' | 'redacted';
      text?: string;
    }>;
  }
}
```

---

## 5. Oracle Server Changes

### 5.1 Where the Changes Go

Everything happens in `apps/app/src/messages/messages.service.ts`, specifically in `flushMatrixEvents()`.

**Today:**
```
flushMatrixEvents()
  → sendMessage(clientType: 'matrix')  ← non-streaming
    → mainAgent.sendMessage()           ← invoke mode, complete result
  → matrixManager.sendMessage(result)  ← post final text
```

**After:**
```
flushMatrixEvents()
  → matrixManager.setTyping(roomId, true)   ← oracle starts "typing"
  → mainAgent.streamMessage()               ← direct streaming (bypasses sendMessage())
  → MatrixStreamBridge.processStream()      ← routes LangGraph events → Matrix
      → on tool start: sendMatrixEvent(ixo.oracle.tool_call { running })
      → on tool end:   sendMatrixEvent(ixo.oracle.tool_call { m.replace, done })
      → on action start/end: same pattern
      → on reasoning complete: sendMatrixEvent(ixo.oracle.reasoning)
      → on render component: sendMatrixEvent(ixo.oracle.render_component)
      → on text chunk: buffer → throttled editMessage every 3s
  → matrixManager.setTyping(roomId, false)
  → matrixManager.sendMessage(finalText)    ← final complete message (or final edit)
```

**Critical:** The existing `sendMessage()` in `messages.service.ts` throws `Error('Response not found')` when `!params.res` (line ~998, ~1032, ~1091). The Matrix path **must not** go through `sendMessage()` for streaming. `flushMatrixEvents()` calls `mainAgent.streamMessage()` directly.

### 5.2 `MatrixStreamBridge` Service

New service: `apps/app/src/messages/matrix-stream-bridge.service.ts`

**Responsibility:** Consume the LangGraph stream (same `AsyncIterable` that the SSE path uses) and route events to Matrix instead of an HTTP response.

```typescript
@Injectable()
export class MatrixStreamBridge {
  constructor(private readonly matrixManager: MatrixManager) {}

  async processStream(options: {
    stream: AsyncIterable<{ data: unknown; event: string; tags: string[] }>;
    roomId: string;
    threadId: string;
    turnId: string;        // eventId of user's triggering message
    sessionId: string;
    requestId: string;
    agActionNames: Set<string>;
    abortController?: AbortController;
  }): Promise<string> {  // returns full accumulated text

    const {
      stream, roomId, threadId, turnId, sessionId, requestId, agActionNames, abortController
    } = options

    // State tracking
    const toolCallEventIds = new Map<string, string>()  // tool_call_id → Matrix event_id
    const actionCallEventIds = new Map<string, string>()
    const toolCallMap = new Map<string, { name: string; args?: unknown }>()
    const actionCallMap = new Map<string, { name: string; args?: unknown }>()
    let accumulatedText = ''
    let textMessageEventId: string | null = null
    let lastTextEditAt = 0
    const TEXT_EDIT_THROTTLE_MS = 3000
    const envelope: OracleEventEnvelope = {
      'ixo.oracle.version': '1',
      'ixo.oracle.session_id': sessionId,
      'ixo.oracle.request_id': requestId,
      'ixo.oracle.turn_id': turnId,
    }

    for await (const { data, event } of stream) {
      if (abortController?.signal.aborted) break

      // ── Tool call started ─────────────────────────────────────────
      if (event === 'on_chat_model_stream') {
        const chunk = data.chunk as AIMessageChunk
        const toolCalls = chunk.tool_calls ?? []

        for (const tc of toolCalls) {
          if (!toolCallMap.has(tc.id)) {
            const isAction = agActionNames.has(tc.name)
            toolCallMap.set(tc.id, { name: tc.name })

            const eventType = isAction ? 'ixo.oracle.action_call' : 'ixo.oracle.tool_call'
            // sendMatrixEvent already returns eventId — no changes needed to MatrixManager
            const eventId = await this.matrixManager.sendMatrixEvent(roomId, eventType, {
              ...envelope,
              tool_call_id: tc.id,
              tool_name: tc.name,
              status: 'running',
            })
            if (isAction) actionCallEventIds.set(tc.id, eventId)
            else toolCallEventIds.set(tc.id, eventId)
          }
        }

        // Text chunk — buffer and throttle edits
        const textContent = typeof chunk.content === 'string' ? chunk.content : ''
        if (textContent) {
          accumulatedText += textContent
          const now = Date.now()
          if (now - lastTextEditAt > TEXT_EDIT_THROTTLE_MS) {
            lastTextEditAt = now
            if (!textMessageEventId) {
              // Send the first real text message (not a placeholder)
              textMessageEventId = await this.matrixManager.sendMessage({
                message: accumulatedText,
                roomId,
                threadId,
                isOracleAdmin: true,
                disablePrefix: true,
              })
            } else {
              // Edit with latest accumulated text
              await this.matrixManager.editMessage({
                messageId: textMessageEventId,
                message: accumulatedText,
                roomId,
                isOracleAdmin: true,
                disablePrefix: true,
              })
            }
          }
        }
      }

      // ── Tool call completed ───────────────────────────────────────
      if (event === 'on_tool_end') {
        const toolMessage = data.output as ToolMessage
        const id = toolMessage.tool_call_id
        const output = typeof toolMessage.content === 'string' ? toolMessage.content : ''

        const isAction = actionCallEventIds.has(id)
        const origEventId = isAction ? actionCallEventIds.get(id) : toolCallEventIds.get(id)
        if (!origEventId) continue

        let status: 'done' | 'error' = 'done'
        let error: string | undefined
        try {
          const parsed = JSON.parse(output)
          if (parsed?.success === false || parsed?.error) {
            status = 'error'
            error = parsed.error
          }
        } catch { /* not JSON, treat as success */ }

        const toolInfo = (isAction ? actionCallMap : toolCallMap).get(id) ?? { name: '' }
        const eventType = isAction ? 'ixo.oracle.action_call' : 'ixo.oracle.tool_call'

        // Edit the running event using m.replace via sendMatrixEvent
        await this.matrixManager.sendMatrixEvent(roomId, eventType, {
          ...envelope,
          tool_call_id: id,
          tool_name: toolMessage.name ?? toolInfo.name,
          args: toolInfo.args,
          status,
          output,
          error,
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: origEventId,
          },
          'm.new_content': {
            ...envelope,
            tool_call_id: id,
            tool_name: toolMessage.name ?? toolInfo.name,
            args: toolInfo.args,
            status,
            output,
            error,
          },
        })

        if (isAction) {
          actionCallEventIds.delete(id)
          actionCallMap.delete(id)
        } else {
          toolCallEventIds.delete(id)
          toolCallMap.delete(id)
        }
      }
    }

    return accumulatedText
  }
}
```

**No placeholder + redact pattern.** The first text chunk sends a real `m.room.message`; subsequent chunks edit it with `editMessage()`. When the stream ends, `flushMatrixEvents()` sends the final complete message (or performs one last edit). No `redactEvent` needed.

### 5.3 Reasoning Extraction

Reasoning tokens arrive via `on_chat_model_stream` but are handled separately from text. After the stream completes, extract the full reasoning from the LangGraph state (it's stored in the last AIMessage's `additional_kwargs.reasoning`) and send one event:

```typescript
// After processStream() completes, in flushMatrixEvents():
const lastMsg = result.messages.at(-1)  // AIMessage from mainAgent
const reasoning = extractReasoning(lastMsg)  // from additional_kwargs
if (reasoning) {
  await matrixManager.sendMatrixEvent(roomId, 'ixo.oracle.reasoning', {
    ...envelope,
    reasoning,
  })
}
```

### 5.4 Modified `flushMatrixEvents()`

```typescript
private async flushMatrixEvents(threadId: string, overRideSessionId?: string): Promise<void> {
  // ... existing buffering logic unchanged ...

  const roomId = events[0].roomId
  const requestId = crypto.randomUUID()
  const turnId = events[0].event.eventId  // user message event_id = turn_id

  // Start typing indicator from oracle's Matrix account
  await this.matrixManager.setTyping(roomId, true, 60_000).catch(() => {})

  try {
    // Build inputMessages same as before...
    const agActionNames = new Set(/* from config or mainAgent */)

    // Call mainAgent.streamMessage() directly — do NOT go through sendMessage()
    // because sendMessage() throws Error('Response not found') without params.res
    const stream = this.mainAgent.streamMessage({
      input: inputMessages,
      runnableConfig,
      // ... other options matching StreamMessageOptions
    })

    // Route stream to Matrix events
    const finalText = await this.matrixStreamBridge.processStream({
      stream,
      roomId,
      threadId,
      turnId,
      sessionId: threadId,
      requestId,
      agActionNames,
    })

    // Send final complete message (replaces or completes any throttled streaming edits)
    if (finalText) {
      await this.matrixManager.sendMessage({
        message: finalText,
        roomId,
        threadId,
        isOracleAdmin: true,
        disablePrefix: true,
      })
    }

    // Send reasoning event if any (extracted from LangGraph state)
    // ... see §5.3

  } finally {
    await this.matrixManager.setTyping(roomId, false).catch(() => {})
  }
}
```

### 5.5 Sync Filter — Critical for Scale

**Problem:** `SimpleMatrixClient.start()` currently passes no filter to `mxClient.start()`. At scale, with 1000 users, the oracle is sending dozens of `ixo.oracle.*` events per conversation. Without a filter, the oracle's own sync will receive all of those events back — an echo chamber that grows with load.

**Fix:** Pass a filter to `mxClient.start()` that restricts what the oracle syncs. The oracle only needs to receive user messages and room state (for crypto). It never needs to receive its own oracle events.

`matrix-bot-sdk`'s `start(filter)` accepts a raw Matrix filter object (same JSON spec as `matrix-js-sdk`'s `Filter.setDefinition()`). The Matrix server supports glob patterns in `not_types`.

**File to change:** `packages/matrix/src/utils/create-simple-matrix-client.ts`

```typescript
// The oracle sync filter — applied on the homeserver, not client-side
const ORACLE_SYNC_FILTER = {
  room: {
    timeline: {
      // Allowlist: only event types the oracle needs to READ
      types: [
        'm.room.message',
        'm.room.encrypted',   // E2E encrypted user messages
      ],
      limit: 50,             // don't replay a huge backlog on startup
    },
    state: {
      types: [
        'm.room.member',
        'm.room.join_rules',
        'm.room.power_levels',
        'm.room.create',
        'm.room.history_visibility',
        'm.room.encryption',  // needed for crypto setup
      ],
      lazy_load_members: true,
    },
    ephemeral: { not_types: ['*'] },    // no typing, receipts
    account_data: { not_types: ['*'] }, // no account data
  },
  presence: { not_types: ['*'] },
}

// In SimpleMatrixClient.start():
await this.mxClient.start(ORACLE_SYNC_FILTER)  // was: await this.mxClient.start()
```

This is a server-side filter — the homeserver simply doesn't send `ixo.oracle.*` events in the sync response. The oracle still sends them fine; it just doesn't receive them back.

**Scale impact:** At 1000 users × 10 oracle events/response → 10K events/min that the oracle no longer syncs. Significant.

### 5.6 `MatrixManager` Changes

| Method | Status | Notes |
|---|---|---|
| `sendMatrixEvent(roomId, eventType, content)` | **Already exists, already returns `Promise<string>` (eventId)** | No changes needed |
| `editMessage(options)` | **Already exists** (`apps/../matrix-manager.ts`) | Used for streaming text edits of `m.room.message` |
| Editing custom events | Use `sendMatrixEvent` with `m.relates_to + m.new_content` in content | No new method needed — see §5.2 tool completion code |
| `setTyping(roomId, isTyping, timeout?)` | **New — add this** | `mxClient.mxClient.sendTyping(roomId, isTyping, timeout)` |

**`redactEvent` is not needed.** We removed the placeholder pattern.

```typescript
// MatrixManager addition — the only new method required:
public async setTyping(
  roomId: string,
  isTyping: boolean,
  timeout = 30_000,
): Promise<void> {
  if (!this.mxClient) throw new Error('Simple client not initialized')
  await this.mxClient.mxClient.sendTyping(roomId, isTyping, timeout)
}
```

---

## 6. Portal Client Changes

The side-chat (`SidebarAiChat` + SSE) is **not touched**. All changes are in the Matrix chat part of Portal.

### 6.1 Where to Change in Portal

The Matrix room timeline in Portal is rendered in:

```
impacts-x-web/matrix/components/RoomTimeline.tsx
```

Line ~1051 defines the event dispatch map:

```typescript
const renderMatrixEvent = useMatrixEventRenderer({
  [MessageEvent.RoomMessage]: (...) => <Message ... />,
  [MessageEvent.RoomMessageEncrypted]: (...) => <Message ... />,
  // m.sticker, call events, etc.
  // ← ADD oracle event handlers HERE
})
```

`useMatrixEventRenderer` (`matrix/hooks/useMatrixEventRenderer.ts`) is a plain `Record<string, EventRenderer<T>>` lookup. Adding oracle events = adding keys to this object. No new listener, no new hook.

```
impacts-x-web/
├── matrix/
│   ├── components/
│   │   ├── RoomTimeline.tsx          ← modify: add oracle event handlers to renderMatrixEvent map
│   │   └── OracleEventRenderer.tsx  ← NEW: renders ixo.oracle.* events as oracle UI components
└── lib/
    └── oracle-ui/
        ├── oracle-ui-components.ts   ← extract from SidebarAiChatMessages.tsx
        ├── group-messages.ts         ← extract from SidebarAiChatMessages.tsx
        └── oracle-message-builders.ts ← new: IMessage mapping functions (§6.3)
```

### 6.2 Hooking into `RoomTimeline.tsx`

```typescript
// In RoomTimeline.tsx, add to the renderMatrixEvent dispatch map:
const renderMatrixEvent = useMatrixEventRenderer({
  // ... existing handlers unchanged ...
  [MessageEvent.RoomMessage]: (mEventId, mEvent, ...) => {
    // If oracle's final text message, render with oracle styling
    if (mEvent.getContent()['ixo.oracle.version']) {
      return <OracleEventRenderer mEvent={mEvent} uiComponents={ORACLE_UI_COMPONENTS} />
    }
    // Normal message path unchanged
    return <Message ... />
  },
  'ixo.oracle.tool_call': (mEventId, mEvent, ...) =>
    <OracleEventRenderer mEvent={mEvent} uiComponents={ORACLE_UI_COMPONENTS} />,
  'ixo.oracle.action_call': (mEventId, mEvent, ...) =>
    <OracleEventRenderer mEvent={mEvent} uiComponents={ORACLE_UI_COMPONENTS} />,
  'ixo.oracle.reasoning': (mEventId, mEvent, ...) =>
    <OracleEventRenderer mEvent={mEvent} uiComponents={ORACLE_UI_COMPONENTS} />,
  'ixo.oracle.render_component': (mEventId, mEvent, ...) =>
    <OracleEventRenderer mEvent={mEvent} uiComponents={ORACLE_UI_COMPONENTS} />,
})
```

**Edit events are already pre-filtered.** `RoomTimeline.tsx` calls `reactionOrEditEvent(mEvent) ? null : renderMatrixEvent(...)` before dispatching — edit events (tool call completions, streaming text edits) are filtered out and never reach our handlers. When an event is edited, `matrix-js-sdk` automatically applies the edit: `mEvent.getContent()` returns the latest content. Both live updates and history replay work correctly with no extra code.

### 6.3 `OracleEventRenderer` Component

```typescript
// impacts-x-web/matrix/components/OracleEventRenderer.tsx

function OracleEventRenderer({ mEvent, uiComponents }: {
  mEvent: MatrixEvent;
  uiComponents: UIComponents;
}) {
  const type = mEvent.getType()
  const content = mEvent.getContent()

  // Skip INTERNAL events from other oracle senders (belt-and-suspenders)
  // Primary protection: isBot check in handleMessage() on the server
  if (content['m.relates_to']?.rel_type === 'm.replace') return null

  const iMessage = useMemo(() => {
    switch (type) {
      case 'ixo.oracle.tool_call':     return buildToolCallIMessage(mEvent)
      case 'ixo.oracle.action_call':   return buildActionCallIMessage(mEvent)
      case 'ixo.oracle.reasoning':     return buildReasoningIMessage(mEvent)
      case 'ixo.oracle.render_component': return buildRenderComponentIMessage(mEvent)
      case 'm.room.message':           return buildOracleTextIMessage(mEvent)
      default: return null
    }
  }, [type, content])  // content reference changes when matrix-js-sdk applies edits

  if (!iMessage) return null

  return renderMessageContent(iMessage.content, uiComponents)
}
```

Because `mEvent.getContent()` is reactive to edits, wrapping in `useMemo` with `content` as dependency means the component re-renders automatically when the oracle edits a tool call (running → done).

### 6.4 Matrix Event → `IMessage` Mapping

These are the exact conversions from Matrix events to the `IComponentMetadata` shape that `renderMessageContent()` + `groupMessages()` already consume:

#### `ixo.oracle.tool_call` → `IMessage`
```typescript
function buildToolCallIMessage(event: MatrixEvent): IMessage {
  const c = event.getContent()
  const toolName = c.tool_name as string
  const uiComponent = c['ixo.oracle.ui_component'] as string | undefined

  return {
    id: event.getId()!,
    type: 'ai',
    content: {
      name: uiComponent ?? toolName,   // custom UI if registered, else generic ToolCall
      props: {
        id: c.tool_call_id,
        args: c.args ?? {},
        status: c.status,              // 'isRunning' | 'done' | 'error'
        output: c.output,
        isToolCall: true,
        toolName,
        error: c.error,
        payload: {
          sessionId: c['ixo.oracle.session_id'],
          requestId: c['ixo.oracle.request_id'],
          eventId: event.getId(),
        },
      },
    },
    toolCalls: [{
      name: toolName,
      id: c.tool_call_id,
      args: c.args ?? {},
      status: c.status,
      output: c.output,
    }],
  }
}
```

#### `ixo.oracle.action_call` → `IMessage`
```typescript
function buildActionCallIMessage(event: MatrixEvent): IMessage {
  const c = event.getContent()
  const toolName = c.tool_name as string
  const output = c.result != null ? JSON.stringify(c.result) : undefined

  return {
    id: event.getId()!,
    type: 'ai',
    content: {
      name: toolName,                  // e.g. 'create_bar_chart' — maps to AgActionArtifact
      props: {
        id: c.tool_call_id,
        args: c.args ?? {},
        status: c.status,
        output,
        isAgAction: true,
        error: c.error,
      },
    },
  }
}
```

#### `ixo.oracle.reasoning` → `IMessage`
```typescript
function buildReasoningIMessage(event: MatrixEvent): IMessage {
  const c = event.getContent()
  return {
    id: event.getId()!,
    type: 'ai',
    content: '',
    reasoning: c.reasoning as string,
    isReasoning: false,    // complete (one event per turn, sent when done)
    isComplete: true,
  }
}
```

#### `ixo.oracle.render_component` → `IMessage`
```typescript
function buildRenderComponentIMessage(event: MatrixEvent): IMessage {
  const c = event.getContent()
  return {
    id: event.getId()!,
    type: 'ai',
    content: {
      name: c.component_name as string,
      props: {
        id: c.event_id ?? event.getId(),
        args: c.props ?? {},
        status: c.status,
      },
    },
  }
}
```

#### `m.room.message` (oracle final text) → `IMessage`
```typescript
function buildOracleTextIMessage(event: MatrixEvent): IMessage | null {
  const c = event.getContent()
  if (!c['ixo.oracle.version']) return null  // not an oracle message
  return {
    id: event.getId()!,
    type: 'ai',
    content: c.body as string,
    isComplete: true,
  }
}
```

### 6.5 Extract Shared UI Resources

Before building the Matrix view, extract from `SidebarAiChatMessages.tsx`:

```
impacts-x-web/lib/oracle-ui/
├── oracle-ui-components.ts      ← uiComponents registry (move from SidebarAiChatMessages inline)
├── group-messages.ts            ← groupMessages() + classifyItem()
└── oracle-message-builders.ts   ← the IMessage builders from §6.4 (shared, used in both paths)
```

Both `SidebarAiChatMessages.tsx` and the new `OracleEventRenderer` import from here.

---

## 7. Typing Indicator

The oracle's Matrix user ID is `@oracle:homeserver`. Since it's a real room member, it can use the standard `m.typing` notification — no custom event needed.

Portal's `RoomViewTyping.tsx` + `typingMembers` zustand store already handle typing indicators for all room members. The oracle sending `m.typing` shows "Oracle is typing..." automatically — **zero Portal changes needed for this feature**.

---

## 8. Artifact Rendering & Presigned URL Refresh

### 8.1 Storing Artifact Data in `ixo.oracle.action_call`

For `artifact_get_presigned_url` actions, store both the stable path AND the cached presigned URLs:

```typescript
// In MatrixStreamBridge, on tool end for artifact_get_presigned_url:
{
  type: 'ixo.oracle.action_call',
  content: {
    ...envelope,
    tool_call_id: id,
    tool_name: 'artifact_get_presigned_url',
    args: { path: '/workspace/output/report.pdf', title: 'Report' },
    status: 'done',
    result: {                               // cached presigned URLs (expire per TTL)
      previewUrl: 'https://s3.../...?X-Amz-Date=...&X-Amz-Expires=604800&...',
      downloadUrl: 'https://s3.../...',
      path: '/workspace/output/report.pdf'
    },
    'ixo.oracle.artifact_path': '/workspace/output/report.pdf',  // stable, for refresh
    'm.relates_to': { rel_type: 'm.replace', event_id: origEventId },
    'm.new_content': { /* same fields */ },
  }
}
```

When this maps to `IMessage` via `buildActionCallIMessage()`, `output = JSON.stringify(result)`. `AgActionArtifact`'s existing `parseArtifactOutput(output)` works without changes.

### 8.2 Presigned URL Expiry Parsing

S3 presigned URLs embed their own expiry:
- `X-Amz-Date=20240101T120000Z` — when signed
- `X-Amz-Expires=604800` — TTL in seconds

```typescript
// impacts-x-web/lib/utils/presignedUrl.ts

export function getS3UrlExpiry(url: string): Date | null {
  try {
    const params = new URL(url).searchParams
    const amzDate = params.get('X-Amz-Date')       // '20240101T120000Z'
    const amzExpires = params.get('X-Amz-Expires')  // e.g. '604800'
    if (!amzDate || !amzExpires) return null

    // Parse X-Amz-Date: YYYYMMDDTHHMMSSZ
    const iso = `${amzDate.slice(0,4)}-${amzDate.slice(4,6)}-${amzDate.slice(6,8)}T${amzDate.slice(9,11)}:${amzDate.slice(11,13)}:${amzDate.slice(13,15)}Z`
    const createdAt = new Date(iso)
    if (isNaN(createdAt.getTime())) return null

    return new Date(createdAt.getTime() + parseInt(amzExpires, 10) * 1000)
  } catch {
    return null
  }
}

export function isS3UrlExpired(url: string, bufferMs = 30_000): boolean {
  const expiry = getS3UrlExpiry(url)
  if (!expiry) return true  // can't parse → refresh to be safe
  return Date.now() + bufferMs >= expiry.getTime()
}

// Optional: show "Expires in 6d 23h" on the artifact card
export function presignedUrlTtlLabel(url: string): string {
  const expiry = getS3UrlExpiry(url)
  if (!expiry) return ''
  const ms = expiry.getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days > 0) return `Expires in ${days}d ${hours}h`
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  return `Expires in ${hours}h ${mins}m`
}
```

### 8.3 Refresh on Click

In `AgActionArtifact.handleClick()`, when `isFileArtifact` and the URL is expired, call sandbox API before loading into canvas:

```typescript
const handleClick = async () => {
  if (isRunning || !args || !currentSessionId) return

  if (isFileArtifact && output) {
    const parsed = parseArtifactOutput(output)
    if (parsed) {
      let urlsToUse = { previewUrl: parsed.previewUrl, downloadUrl: parsed.downloadUrl }

      if (isS3UrlExpired(parsed.previewUrl)) {
        const artifactPath = (args as Record<string, unknown>)['path'] as string
        const fresh = await refreshPresignedUrl(artifactPath)  // calls sandbox API (§8.4)
        if (fresh) urlsToUse = fresh
      }

      const config = {
        ...(args as Record<string, unknown>),
        previewUrl: urlsToUse.previewUrl,
        downloadUrl: urlsToUse.downloadUrl,
        path: parsed.path ?? (args as Record<string, unknown>)['path'],
        onUrlRefresh: () => refreshPresignedUrl(
          (args as Record<string, unknown>)['path'] as string
        ),
      }
      // ... load into canvas as before
    }
  }
}
```

### 8.4 Sandbox Presigned URL Endpoint (Placeholder)

```typescript
// impacts-x-web/lib/utils/presignedUrl.ts

const SANDBOX_BASE_URL = process.env.NEXT_PUBLIC_SANDBOX_BASE_URL

export async function refreshPresignedUrl(
  path: string
): Promise<{ previewUrl: string; downloadUrl: string } | null> {
  try {
    // TODO: replace with actual endpoint + method when confirmed
    const res = await fetch(`${SANDBOX_BASE_URL}/ENDPOINT_PLACEHOLDER`, {
      method: 'POST',  // or GET — confirm with API
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return {
      previewUrl: data.previewUrl,
      downloadUrl: data.downloadUrl ?? data.url,
    }
  } catch {
    return null
  }
}
```

### 8.5 `ArtifactPreview` Error Recovery

Pass `onUrlRefresh` through the canvas config. If `fetch(previewUrl)` fails in `TextOrCodePreview`:

```typescript
// In the fetch error handler:
if (error && onUrlRefresh) {
  return (
    <Button onClick={async () => {
      const fresh = await onUrlRefresh()
      if (fresh) setCurrentUrl(fresh.previewUrl)
    }}>
      Reload
    </Button>
  )
}
```

---

## 9. Notes

### Self-sent events

The oracle's own messages are already skipped by `handleMessage()` via the `isBot` check (line ~238 of `messages.service.ts`). No extra flag needed — oracle events will never be re-processed as user input.

### Edit events never double-render

`RoomTimeline.tsx` calls `reactionOrEditEvent(mEvent) ? null : renderMatrixEvent(...)` before dispatching. `m.replace` edits are filtered out by this check and never reach the oracle renderers. `matrix-js-sdk` applies edits automatically: `mEvent.getContent()` always returns the latest version of an edited event — both live and on history replay.

### History

LangGraph holds the AI conversation history (checkpoints). Matrix holds the room message history. Both already work. No extra replay logic needed.

---

## 10. Group Chats — Oracles + Humans in the Same Room

### 10.1 The Model

Group rooms work exactly like 1:1 rooms at the Matrix level. The difference is turn dedication: in a 1:1 room the oracle processes every message; in a group room it only responds when explicitly addressed. The routing mechanism is **Matrix mentions** — already a first-class Matrix feature, already rendered in Portal.

```
Group room: @human-a, @human-b, @oracle-finance, @oracle-compliance
  ↓
@human-a: "Hey @oracle-finance can you run the Q1 projections?"
  → oracle-finance is mentioned → processes → responds
  → oracle-compliance is NOT mentioned → stays silent

@oracle-finance: "@oracle-compliance can you verify the regulatory limits on this?"
  → oracle-compliance is mentioned → processes oracle-finance's context → responds
  → oracle-finance is NOT mentioned in oracle-compliance's reply → does NOT re-trigger
```

No central dispatcher. Each oracle watches for its own Matrix user ID in `m.mentions`. This scales horizontally — adding a new oracle to a group room requires zero changes to other oracles.

### 10.2 Turn Dedication — Hybrid Mention + Thread Ownership

**Mention-only** is simple but forces `@oracle` on every follow-up message in a conversation — feels robotic. **Thread ownership** makes conversations feel natural. The right rule:

| Situation | Rule |
|---|---|
| Top-level room message (no thread) | Must be `@mentioned` — multiple oracles present, must be explicit |
| Thread reply, only one oracle has spoken in this thread | That oracle auto-continues — it owns the thread |
| Thread reply, multiple oracles have spoken in this thread | Must be `@mentioned` — ambiguous, require explicit routing |

This gives natural multi-turn conversations with a single oracle while keeping multi-oracle threads unambiguous.

**Thread ownership check** is cheap — the oracle already has the room in memory from sync. It scans thread event senders, no extra API call:

```typescript
private async shouldRespond(roomId: string, event: MatrixEvent): Promise<boolean> {
  const senderId = event.getSender()
  if (this.matrixManager.isOwnUserId(senderId)) return false  // own message

  const mentions = (event.getContent()['m.mentions'] as { user_ids?: string[] } | undefined)
  const oracleUserId = this.matrixManager.getOwnUserId()

  // Explicit mention always wins
  if (mentions?.user_ids?.includes(oracleUserId)) return true

  const memberCount = await this.matrixManager.getRoomMemberCount(roomId)
  if (memberCount <= 2) return true   // 1:1 room — always respond

  // Group room without mention: check thread ownership
  const threadId = event.getContent()['m.relates_to']?.event_id
  if (!threadId) return false   // top-level group message, not mentioned → silent

  // Scan thread events to find which oracles have spoken
  const threadOracleSenders = this.matrixManager.getThreadOracleSenders(roomId, threadId)
  // Only one oracle in thread and it's us → we own the thread
  return threadOracleSenders.size === 1 && threadOracleSenders.has(oracleUserId)
}
```

`getThreadOracleSenders()` walks the in-memory room timeline filtered to `threadId`, collects senders that match known oracle user IDs. The room is already in sync memory — no HTTP request.

`handleMessage()` becomes:

```typescript
private async handleMessage(roomId: string, event: MatrixEvent): Promise<void> {
  if (!(await this.shouldRespond(roomId, event))) return
  this.debounce(roomId, () => this.flushMatrixEvents(roomId, ...))
}
```

### 10.3 Oracle-to-Oracle Delegation

When Oracle A's LangGraph agent decides Oracle B should handle part of a task, it sends a message mentioning Oracle B:

```
Oracle A → m.room.message:
  body: "@oracle-compliance please verify: [data]"
  content['m.mentions'] = { user_ids: ['@oracle-compliance:homeserver'] }
```

Oracle B's `handleMessage()` fires (the mention check passes — sender is a bot but the mention is for Oracle B). Oracle B then processes with full context: it sees the thread, knows Oracle A invoked it, and can read Oracle A's prior oracle events in the thread.

**Preventing infinite loops:** When the sender is another oracle (`senderIsBot && isGroupRoom`), inject `invokedByOracle: true` into the LangGraph config/userContext. The main agent's system prompt uses this signal to skip delegation and just answer directly. Hard cap: if `invokedByOracle` depth reaches 3, the oracle responds but does not mention any other oracle.

```typescript
const invokedByOracle = isGroupRoom && this.matrixManager.isKnownOracleUserId(senderId)
// pass to flushMatrixEvents → runnableConfig → graph state
```

`isKnownOracleUserId()` checks a configurable list of oracle Matrix user IDs (set via env var `ORACLE_PEER_USER_IDS`).

### 10.4 Thread Confinement

In a busy group room, oracle responses must stay threaded to the message they're replying to. Otherwise the room timeline becomes unreadable.

- If the triggering message is inside a thread → oracle replies in the same thread
- If the triggering message is a top-level room message → oracle starts a new thread from it (its first `m.room.message` reply uses `m.thread` relation pointing to the trigger)

```typescript
// In flushMatrixEvents(), derive threadId:
const triggerRelation = triggerEvent.getContent()['m.relates_to']
const threadId =
  triggerRelation?.rel_type === 'm.thread'
    ? triggerRelation.event_id          // already in a thread → use it
    : triggerEvent.getId()!             // top-level message → start thread here
```

This is the same `threadId` already passed to `matrixManager.sendMessage()` — no new machinery.

### 10.5 Group Room Context in the Agent

When invoked in a group room, inject into `userContext`:

```typescript
userContext: {
  ...existing,
  groupRoom: {
    memberCount,
    peers: roomMembers.filter(m => m.userId !== oracleUserId).map(m => ({
      userId: m.userId,
      displayName: m.name,
      isOracle: isKnownOracleUserId(m.userId),
    })),
    invokedByOracle,
  }
}
```

The main agent's system prompt can use this: knows it's in a multi-agent room, knows who the other participants are, can reference them by name in responses.

### 10.6 What Changes

| Component | Change |
|---|---|
| `handleMessage()` | Add group room mention check |
| `MatrixManager` | `isOwnUserId()`, `getRoomMemberCount()`, `isKnownOracleUserId()` helper methods |
| `flushMatrixEvents()` | Thread ID derivation from trigger event relation |
| `runnableConfig` / `userContext` | `invokedByOracle`, `groupRoom` context fields |
| Env config | `ORACLE_PEER_USER_IDS` (comma-separated list of peer oracle Matrix IDs) |
| Portal | Nothing — Matrix renders mentions natively, thread confinement is a Matrix feature, typing indicators work per-member |

---

## 11. What to Build / Dependencies

### Oracle Server (`apps/app`)


| Need | Action |
|---|---|
| `sendMatrixEvent` returns eventId | **Already done** — `Promise<string>` is already the return type |
| Edit custom events | Use `sendMatrixEvent` with `m.relates_to + m.new_content` in content — **no new method needed** |
| Set typing | Add `MatrixManager.setTyping(roomId, isTyping, timeout?)` — **only new method needed** |
| Sync filter | Pass `ORACLE_SYNC_FILTER` to `mxClient.start()` in `SimpleMatrixClient.start()` — **critical for scale** |
| `MatrixStreamBridge` | New service in `apps/app/src/messages/` |
| Switch Matrix path to streaming | Modify `flushMatrixEvents()` to call `mainAgent.streamMessage()` directly |
| Group room mention check | Add to `handleMessage()` — skip if not mentioned |
| `MatrixManager` group helpers | `getRoomMemberCount()`, `isKnownOracleUserId()` |
| Oracle-to-oracle depth cap | `invokedByOracle` + depth in `runnableConfig` |
| `ORACLE_PEER_USER_IDS` | New env var — comma-separated peer oracle Matrix IDs |

### Portal (`impacts-x-web`)

| Need | Action |
|---|---|
| Render oracle events | Add handlers to `RoomTimeline.tsx` `renderMatrixEvent` dispatch map (~line 1051) |
| `OracleEventRenderer` | New component in `matrix/components/` |
| `IMessage` builders | New `lib/oracle-ui/oracle-message-builders.ts` |
| uiComponents registry | Extract from `SidebarAiChatMessages.tsx` to `lib/oracle-ui/oracle-ui-components.ts` |
| S3 URL utils | New `lib/utils/presignedUrl.ts` |
| Typing indicator | **Already works** — oracle `m.typing` → Portal shows it automatically |
| `AgActionArtifact` click handler | Modify to add `isS3UrlExpired` check + refresh |
| `ArtifactPreview` | Add `onUrlRefresh` prop + error recovery button |

---

## 11. Implementation Phases

### Phase 0 — Shared types (0.5 day)
- Define `OracleEventEnvelope` and all `ixo.oracle.*` event content interfaces
- Add to `@ixo/matrix` package types or local types file

### Phase 1 — Oracle emits rich events (2–3 days)
- `MatrixManager.setTyping()` — only new method needed
- `ORACLE_SYNC_FILTER` passed to `mxClient.start()` in `SimpleMatrixClient.start()`
- `MatrixStreamBridge` service
- Modify `flushMatrixEvents()` to call `mainAgent.streamMessage()` directly + bridge
- Test: confirm `ixo.oracle.tool_call`, `ixo.oracle.action_call`, `ixo.oracle.reasoning` appear in Matrix room

### Phase 2 — Portal renders oracle events (3–4 days)
- Extract `uiComponents` registry and `groupMessages` to `lib/oracle-ui/`
- `oracle-message-builders.ts` with all IMessage mapping functions
- `OracleEventRenderer` component
- Wire into `RoomTimeline.tsx` `renderMatrixEvent` dispatch map
- Test: tool calls, artifacts, reasoning all render correctly in Matrix chat

### Phase 3 — Artifact URL refresh (1–2 days)
- `presignedUrl.ts` utility (expiry parsing + refresh function)
- Modify `AgActionArtifact.handleClick()` with expiry check
- Add `onUrlRefresh` to `ArtifactPreview`
- Fill in sandbox API endpoint (user to provide)

### Phase 4 — Group Chats (1–2 days)
- Mention check in `handleMessage()`
- `MatrixManager` helper methods (`getRoomMemberCount`, `isKnownOracleUserId`)
- Thread ID derivation from trigger event
- `ORACLE_PEER_USER_IDS` env var + depth-capped oracle-to-oracle delegation
- `groupRoom` context injection into LangGraph state

### Phase 5 — Polish
- Handle edge cases (missing turn_id, partial turns, encrypted-but-not-decrypted events)
- Optionally: show "Expires in Xd Xh" label on file artifact cards
