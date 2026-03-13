# File System via Editor & Memory Integration

## ORA-166 Feature Presentation

---

## Slide 1: The Problem

Oracles are stateless by default — they can have conversations, but they can't **create**, **store**, or **recall** documents.

**What users need:**

- Ask the oracle to "save this research as a page"
- Oracle creates a persistent, editable document
- The document lives in the user's workspace — not lost in chat history
- Oracle remembers what it wrote and can update it later

**What we didn't have:**

- No file system for oracles
- No way to create pages from chat
- No memory of document operations
- No UI feedback when pages are created/updated

---

## Slide 2: The Solution — Pages as Matrix Rooms

Instead of building a traditional file system, we use what we already have: **Matrix**.

Every "file" is a **CRDT document (Y.Doc) synced to a Matrix room**.

| Concept       | How it works                                                |
| ------------- | ----------------------------------------------------------- |
| A "file"      | A Matrix room containing a Y.Doc                            |
| File ID       | The Matrix `room_id`                                        |
| File name     | Room alias: `page-{timestamp}`                              |
| File content  | BlockNote blocks inside Y.js XmlFragment                    |
| File metadata | Y.js Map: title, owner DID, creation date                   |
| Storage       | Matrix homeserver (E2E encrypted)                           |
| Collaboration | Real-time via CRDT — multiple users can edit simultaneously |

**Why this is powerful:** We get encryption, persistence, real-time collaboration, and access control for free — no new infrastructure needed.

---

## Slide 3: What We Built — Overview

Three workstreams delivered together:

```
+---------------------------+     +---------------------------+     +---------------------------+
|        BACKEND            |     |        FRONTEND           |     |      MEMORY ENGINE        |
|                           |     |                           |     |                           |
|  3 Page Tools (LangGraph) |     |  2 Tool Call UI Cards     |     |  Fire-and-forget logging  |
|  - create_page            |     |  - CreatePageToolCall     |     |  - Page create/update     |
|  - read_page              |     |  - UpdatePageToolCall     |     |  - Editor session summary |
|  - update_page (with diff)|     |                           |     |  - Operation counting     |
|                           |     |  Space resolution         |     |                           |
|  Block action enhancements|     |  - Personal pages space   |     |  Auth via Matrix OpenID   |
|  - insertBlock            |     |  - Domain pages space     |     |  tokens                   |
|  - moveBlock              |     |                           |     |                           |
|  - findParentOf           |     |  Message rendering refactor|    |                           |
|                           |     |  - Grouped messages       |     |                           |
|  Subagent tool forwarding |     |  - Component registry     |     |                           |
+---------------------------+     +---------------------------+     +---------------------------+
```

---

## Slide 4: Page Tools — create_page

The oracle can now create pages on behalf of the user.

**What happens when a user says "Create a page about X":**

```
User: "Create a page about our Q1 results"
         |
         v
  +------------------+
  | Oracle decides to |
  | call create_page  |
  +------------------+
         |
         v
  +------------------+
  | 1. Generate alias |  -->  page-1710234567890
  | 2. Create Matrix  |  -->  Private room, E2E encrypted
  |    room           |
  | 3. Set power      |  -->  Oracle: 100, User: 50
  |    levels         |
  | 4. Parse markdown  |  -->  Headings, lists, bold -> blocks
  |    into blocks    |
  | 5. Init Y.Doc     |  -->  Metadata + content blocks
  | 6. Nest under     |  -->  m.space.child event
  |    user's space   |
  | 7. Log to Memory  |  -->  Fire-and-forget
  |    Engine         |
  +------------------+
         |
         v
  Returns: { roomId, alias, title, ownerDid, blockCount }
```

**Input:**

```typescript
{
  title: "Q1 Results",           // required
  topic: "Revenue and growth",   // optional description
  content: "## Revenue\n- Q1: $2.4M\n- Growth: 15%"  // optional markdown
}
```

**Output:**

```typescript
{
  success: true,
  roomId: "!abc123:matrix.ixo.earth",
  alias: "page-1710234567890",
  title: "Q1 Results",
  ownerDid: "did:ixo:entity:abc123",
  createdAt: "2026-03-12T10:30:00.000Z",
  blockCount: 3
}
```

---

## Slide 5: Page Tools — update_page (with Diff Tracking)

The oracle can update existing pages and we track exactly what changed.

**Diff tracking flow:**

```
Before mutation:
  +----------------------------+
  | Snapshot OLD state          |
  | - Old title (from Y.Text)  |
  | - Old topic (from room)    |
  | - Old content (blocks ->   |
  |   markdown via lossy       |
  |   conversion)              |
  +----------------------------+
         |
         v
  +----------------------------+
  | Apply mutations inside     |
  | doc.transact()             |
  | - Replace title            |
  | - Update topic             |
  | - Replace/append blocks    |
  +----------------------------+
         |
         v
After mutation:
  +----------------------------+
  | Snapshot NEW state          |
  | - New title                |
  | - New topic                |
  | - New content (blocks ->   |
  |   markdown)                |
  +----------------------------+
         |
         v
  +----------------------------+
  | Build PageDiff             |
  | {                          |
  |   title: {                 |
  |     old: "Q1 Results",     |
  |     new: "Q1 Final Results"|
  |   },                       |
  |   content: {               |
  |     old: "## Revenue...",  |
  |     new: "## Revenue..."   |
  |   }                        |
  | }                          |
  +----------------------------+
```

**The PageDiff interface:**

```typescript
interface PageDiff {
  title?: { old: string; new: string };
  topic?: { old: string; new: string };
  content?: { old: string; new: string }; // full markdown before/after
}
```

This enables GitHub-style change visualization and future AI-generated summaries.

---

## Slide 6: Page Tools — read_page

Simple but context-aware.

**Two modes — same tool, different schema:**

| Mode               | When                                   | Schema                              |
| ------------------ | -------------------------------------- | ----------------------------------- |
| **Editor context** | User has a page open in the editor     | No params needed — room ID baked in |
| **Standalone**     | Called from main chat (no editor open) | Requires `room_id` param            |

**Why?** Reduces cognitive load on the LLM. When the user is already editing a page, the oracle shouldn't have to figure out which room to read — it just knows.

**Output:**

```typescript
{
  success: true,
  roomId: "!abc123:matrix.ixo.earth",
  metadata: {
    "@context": "https://ixo.world/page/0.1",
    createdAt: "2026-03-12T10:30:00.000Z",
    ownerDid: "did:ixo:entity:abc123"
  },
  blocks: [
    { id: "block-1", type: "heading", text: "Revenue", properties: { level: 2 } },
    { id: "block-2", type: "bulletListItem", text: "Q1: $2.4M", properties: {} }
  ],
  blockCount: 2
}
```

---

## Slide 7: Context-Aware Tool Schemas

A key architectural decision — the same tool adapts its interface based on where it's called from.

```
+------------------------------------------+
|           EDITOR AGENT CONTEXT           |
|  (user has a page open in the editor)    |
|                                          |
|  read_page()     <-- no params needed    |
|  update_page({                           |
|    title?: "...",                         |
|    content?: "..."                        |
|  })              <-- no room_id needed   |
|  create_page({                           |
|    title: "..."                          |
|  })              <-- creates NEW page    |
+------------------------------------------+

+------------------------------------------+
|          STANDALONE CONTEXT              |
|  (called from main chat, no editor)      |
|                                          |
|  read_page({                             |
|    room_id: "!abc:matrix.ixo.earth"      |
|  })              <-- room_id required    |
|  update_page({                           |
|    room_id: "!abc:matrix.ixo.earth",     |
|    title?: "...",                         |
|    content?: "..."                        |
|  })              <-- room_id required    |
+------------------------------------------+
```

**Result:** The LLM makes fewer errors because it doesn't have to manage room IDs when they're already known from context.

---

## Slide 8: Subagent Tool Forwarding

A novel pattern for multi-agent LangGraph architectures.

**The problem:** The editor agent is a subagent. When it calls `create_page`, that tool call is invisible to the parent graph and the SSE stream — the frontend never sees it.

**The solution:** Selective tool call forwarding via LangGraph `Command`.

```
Main Agent (parent graph)
  |
  |-- delegates to Editor Agent (subagent)
  |     |
  |     |-- edit_block       --> stays in subagent (internal)
  |     |-- create_block     --> stays in subagent (internal)
  |     |-- create_page      --> FORWARDED to parent graph
  |     |-- update_page      --> FORWARDED to parent graph
  |     |
  |     +-- onComplete callback --> logs to Memory Engine
  |
  |<-- receives forwarded create_page/update_page tool calls
  |
  v
SSE Stream --> Frontend renders CreatePageToolCall / UpdatePageToolCall cards
```

**Configuration:**

```typescript
createSubagentAsTool(editorAgentSpec, {
  forwardTools: ['create_page', 'update_page'],
  onComplete: (messages, query) =>
    logEditorSessionToMemory(memoryAuth, messages, editorRoomId, query),
});
```

---

## Slide 9: Memory Engine Integration

Every page operation is logged to the Memory Engine — fire-and-forget.

**Design principle:** Memory writes NEVER block user-facing operations. If the Memory Engine is down, everything still works.

```
Page operation completes
  |
  v
+--------------------+     +-------------------+
| logPageOperation   | --> | Memory Engine MCP  |
| ToMemory()         |     | POST /messages     |
|                    |     |                    |
| - Page name        |     | Headers:           |
| - Owner DID        |     | x-oracle-token     |
| - Created/updated  |     | x-user-token       |
| - Block count      |     | x-oracle-homeserver|
| - Space ID         |     | x-user-homeserver  |
+--------------------+     | x-room-id          |
        |                  +-------------------+
        |
  Fire & forget
  (async, non-blocking)
```

**Editor session logging** — after the editor agent completes:

```
logEditorSessionToMemory():
  1. Scan message history for mutation tool calls
  2. Count operations by type:
     - 3x edit_block
     - 2x create_block
     - 1x create_page
  3. Extract page title from read_flow_context
  4. Build summary:
     "Page 'Q1 Results' - user asked 'add revenue data' -
      3 edit_block, 2 create_block, 1 create_page"
  5. POST to Memory Engine (fire & forget)
```

---

## Slide 10: Frontend — Tool Call Cards

[INSERT SCREENSHOT: CreatePageToolCall card]

**CreatePageToolCall** renders when the oracle creates a page:

- Shows page title (with emoji support)
- Displays topic/description
- Block count indicator
- **"Open page"** button — navigates directly to the editor
- **"Copy link"** button — shareable URL to clipboard

[INSERT SCREENSHOT: UpdatePageToolCall card]

**UpdatePageToolCall** renders when the oracle updates a page:

- **Update type badge:** "Replace content" / "Append content" / "Metadata only"
- Content preview (first 150 characters)
- List of updated fields (title, topic, content)
- Block count after update
- Same navigation and link-copy actions

---

## Slide 11: Frontend — Space Resolution

The frontend automatically resolves where new pages should be organized.

```
User opens chat
  |
  v
+------------------------------+
| usePersonalDomainSpaces()    |  If user is in a domain context
| -> personalDomainPagesSpace  |  -> pages-personal-{userId}-{entityDid}
+------------------------------+
  |
  | OR
  v
+------------------------------+
| usePersonalWorkspaceSpaces() |  If user is in workspace context
| -> personalPagesSpace        |  -> workspace-pages-{userAddress}
+------------------------------+
  |
  v
spaceId sent to backend on EVERY message
  |
  v
Oracle creates pages under this space
  -> m.space.child / m.space.parent events
  -> Pages appear in the user's page list
```

**Result:** Pages created by the oracle automatically show up in the right place — the user's personal pages space, organized by domain or workspace.

---

## Slide 12: Frontend — Message Rendering Refactor

Extracted and improved the chat message rendering system.

**New `SidebarAiChatMessages.tsx`:**

```
Message stream from oracle
  |
  v
groupMessages(messages)
  |-- Groups consecutive AI messages together
  |-- Groups consecutive human messages together
  |-- Cleaner visual separation
  |
  v
uiComponents registry (tool name -> React component)
  |
  |-- "create_page"              -> CreatePageToolCall
  |-- "update_page"              -> UpdatePageToolCall
  |-- "submitClaim"              -> SubmitClaim
  |-- "AgActionToolCall"         -> AgActionArtifact (charts, tables)
  |-- "artifact_get_presigned_url" -> AgActionArtifact
  |-- "Error"                    -> OracleError
  |-- (default)                  -> SimpleToolCall
  |
  v
Rendered as HumanMessageGroup / AiMessageGroup
  |-- Text content
  |-- File attachments
  |-- Thinking/reasoning blocks
  |-- Tool call cards (from registry above)
```

---

## Slide 13: Emoji Pipeline

LLMs produce emoji shortcodes (`:rocket:`, `:chart_with_upwards_trend:`). Users expect to see actual emoji. We handle this at three layers:

```
Layer 1: INPUT (page-tools.ts)
  User content -> emojify() -> stored in Y.Doc
  "Launch :rocket:" -> "Launch [rocket emoji]"

Layer 2: OUTPUT (messages.service.ts)
  Tool results -> emojify() -> sent via SSE
  "Created page :white_check_mark:" -> "Created page [checkmark emoji]"

Layer 3: TRANSFORM (common utils)
  Final messages -> emojify() -> displayed in chat
  Catches any remaining shortcodes before rendering
```

**Package:** `node-emoji` (BE) + emojibase (FE)

---

## Slide 14: Block Action Enhancements

New positional operations for the editor agent — beyond basic create/edit/delete.

**`findParentOf(container, blockId)`**

- Recursively walks the Y.js document tree
- Finds any block's parent container and index position
- Foundation for positional operations

**`insertBlock(doc, { placement, referenceBlockId })`**

- Insert a block **before** or **after** any reference block
- Maintains document structure and block attributes

**`moveBlock(doc, { blockId, referenceBlockId, placement })`**

- Relocate a block to a new position
- Handles index shifts (when removing a block changes target position)
- Preserves block ID, content, and audit trail

```
Before moveBlock:               After moveBlock:
  [Block A]                       [Block A]
  [Block B]  <-- move this        [Block C]
  [Block C]                       [Block B]  <-- moved after C
```

---

## Slide 15: End-to-End Architecture

```
+-------------+     +------------------+     +------------------+
|   Frontend  |     |     Backend      |     |  Infrastructure  |
|             |     |                  |     |                  |
| SidebarChat |---->| NestJS API       |     | Matrix Homeserver|
|   |         |     |   |              |     |   (E2E encrypted)|
|   |         |     |   v              |     |                  |
|   |         |     | LangGraph Engine |     | Memory Engine MCP|
|   |         |     |   |              |     |   (knowledge DB) |
|   |         |     |   +-- Main Agent |     |                  |
|   |         |     |   |    |         |     |                  |
|   |         |     |   |    +-- Editor|---->| Y.Doc + Matrix   |
|   |         |     |   |    |  Agent  |     | Provider (CRDT)  |
|   |         |     |   |    |         |     |                  |
|   |         |     |   |    +-- Page  |---->| Matrix Rooms     |
|   |         |     |   |       Tools  |     | (page storage)   |
|   |         |     |   |              |     |                  |
|   |         |<----|   +-- SSE Stream |     |                  |
|   |         |     |      (tool calls |     |                  |
|   v         |     |       forwarded) |     |                  |
| Tool Cards  |     |                  |     |                  |
| - Create    |     | Memory Logging   |---->| Memory Engine    |
| - Update    |     | (fire & forget)  |     | (async POST)     |
+-------------+     +------------------+     +------------------+
```

---

## Slide 16: What's Next

| Item                                                                    | Ticket | Status  |
| ----------------------------------------------------------------------- | ------ | ------- |
| `list_pages` tool — browse and search pages                             | Future | Planned |
| `delete_page` tool — archive with memory tracking                       | Future | Planned |
| Background watcher — detect FE edits, trigger memory updates            | Future | Planned |
| AI-generated summaries — replace operation counts with natural language | Future | Planned |
| Diff visualization — render PageDiff as GitHub-style change view in UI  | Future | Idea    |

---

## Slide 17: Summary

**What we shipped:**

- **3 page tools** — create, read, update (with diff tracking) — available as LangGraph tools for the oracle
- **Context-aware schemas** — tools adapt their interface based on editor vs standalone context
- **Subagent tool forwarding** — novel pattern making subagent operations visible in the parent SSE stream
- **Memory Engine integration** — fire-and-forget logging of all page operations and editor sessions
- **2 frontend UI components** — interactive cards for create/update with navigation and link sharing
- **Space resolution** — pages automatically organized under the user's personal or domain space
- **Emoji pipeline** — 3-layer conversion ensuring emoji render correctly everywhere
- **Block action enhancements** — positional insert and move operations for the editor agent

**Key design principles:**

- No new infrastructure — built on Matrix (encryption, persistence, collaboration for free)
- Graceful degradation — memory engine failures never block operations
- LLM-friendly — context-aware schemas reduce errors
- Full-stack — BE tools + FE rendering + memory logging delivered together
