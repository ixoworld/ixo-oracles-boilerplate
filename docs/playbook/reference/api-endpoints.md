# Reference: API Endpoints

> REST API surface from NestJS controllers.

---

## Required Headers

| Header                  | Required | Description                  |
| ----------------------- | -------- | ---------------------------- |
| `x-matrix-access-token` | Yes      | User's Matrix access token   |
| `x-did`                 | Yes      | User's DID                   |
| `x-matrix-homeserver`   | No       | User's Matrix homeserver URL |
| `x-timezone`            | No       | User's timezone              |

---

## Sessions

### Create Session

```
POST /sessions
```

Creates a new chat session.

**Headers:** `x-matrix-access-token`, `x-did`

**Response:** `201 Created`

```json
{
  "sessionId": "string",
  "roomId": "string"
}
```

### List Sessions

```
GET /sessions?limit=20&offset=0
```

Lists all sessions for the authenticated user.

**Headers:** `x-matrix-access-token`, `x-did`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Results per page |
| `offset` | number | 0 | Pagination offset |

**Response:** `200 OK`

```json
[
  {
    "sessionId": "f7a291c3-8e42-4b1a-9d3f-1a2b3c4d5e6f",
    "roomId": "!abc123xyz:matrix.ixo.world",
    "createdAt": "2025-09-15T10:30:00Z"
  },
  {
    "sessionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "roomId": "!def456uvw:matrix.ixo.world",
    "createdAt": "2025-09-14T08:15:00Z"
  }
]
```

### Delete Session

```
DELETE /sessions/:sessionId
```

Deletes a specific session.

**Headers:** `x-matrix-access-token`, `x-did`

**Response:** `200 OK`

```json
{
  "message": "Session deleted successfully"
}
```

---

## Messages

### Send Message

```
POST /messages/:sessionId
```

Sends a message to the oracle. Supports both streaming (SSE) and standard responses.

**Headers:** `x-matrix-access-token`, `x-did`

**Body:**

```json
{
  "message": "string",
  "stream": true,
  "browserTools": [],
  "editorRoomId": "string (optional)",
  "currentEntityDid": "string (optional)"
}
```

**Response:**

- If `stream: true` — SSE event stream (`text/event-stream`):

```
event: tool_call
data: {"toolName": "search_skills", "args": {"query": "web research"}}

event: render_component
data: {"type": "markdown", "content": "Here's what I found..."}

event: message
data: {"content": "I found several relevant skills for web research."}

event: done
data: {}
```

- If `stream: false` — `200 OK` with JSON response:

```json
{
  "content": "I found several relevant skills for web research.",
  "toolCalls": []
}
```

### List Messages

```
GET /messages/:sessionId
```

Lists all messages in a session.

**Headers:** `x-matrix-access-token`, `x-did`

**Response:** `200 OK`

```json
[
  {
    "role": "user",
    "content": "Hello, what can you do?",
    "timestamp": "2025-09-15T10:31:00Z"
  },
  {
    "role": "assistant",
    "content": "I can help you with research, summarization, and more!",
    "timestamp": "2025-09-15T10:31:02Z"
  }
]
```

### Abort Stream

```
POST /messages/abort
```

Aborts an ongoing streaming request.

**Body:**

```json
{
  "sessionId": "string"
}
```

**Response:** `200 OK`

```json
{
  "success": true
}
```

---

## Health

### Health Check

```
GET /
```

Returns application status. No authentication required.

**Response:** `200 OK`

```json
{
  "status": "ok"
}
```

---

## Swagger Documentation

Interactive API docs available at `/docs` when the server is running.
