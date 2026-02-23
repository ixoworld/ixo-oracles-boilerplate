# Reference: API Endpoints

> REST API surface from NestJS controllers.

---

## Required Headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-matrix-access-token` | Yes | User's Matrix access token |
| `x-did` | Yes | User's DID |
| `x-matrix-homeserver` | No | User's Matrix homeserver URL |
| `x-timezone` | No | User's timezone |

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
- If `stream: true` — SSE event stream (`text/event-stream`)
- If `stream: false` — `200 OK` with JSON response

### List Messages

```
GET /messages/:sessionId
```

Lists all messages in a session.

**Headers:** `x-matrix-access-token`, `x-did`

**Response:** `200 OK`

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

Returns application status.

**Response:** `200 OK`

---

## Swagger Documentation

Interactive API docs available at `/docs` when the server is running.
