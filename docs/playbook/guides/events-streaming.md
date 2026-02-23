# Guide: Events & Streaming — @ixo/events

> **What you'll build:** Real-time event streaming via SSE and WebSocket for tool calls, component rendering, and message updates.

---

## Event Types

<!-- TODO: Expand each with fields, when emitted, and example payloads -->

| Event | Purpose |
|-------|---------|
| `ToolCallEvent` | Notify client of tool execution |
| `RenderComponentEvent` | Request client to render a UI component |
| `BrowserToolCallEvent` | Invoke a client-side tool (reverse call) |
| `MessageCacheInvalidationEvent` | Invalidate cached messages |
| `RouterEvent` | Client-side navigation |

---

## SSE Streaming

<!-- TODO: MainAgentGraph.streamMessage() → NestJS pipes as SSE -->

---

## Emitting Events

<!-- TODO: Standard emission pattern: new ToolCallEvent({...}).emit() -->

---

## Direct SSE Publishing

<!-- TODO: sseService.publishToSession() for custom events -->

---

## Client Consumption

<!-- TODO: useChat hook handles events automatically -->

**Source:** `packages/events/`
