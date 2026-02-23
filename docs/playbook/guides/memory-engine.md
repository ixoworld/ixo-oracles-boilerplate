# Guide: Memory Engine — Give Your Oracle Memory

> **What you'll build:** Persistent memory across conversations — user memories, organization knowledge (public and private), powered by the Memory Engine MCP server.

---

## What is the Memory Engine

<!-- TODO: Expand with architecture explanation -->

The Memory Engine is an MCP server that provides persistent memory across conversations. It supports three knowledge scopes:

- **User memories (private)** — personal details per user, only that user can access
- **Organization public knowledge** — customer-facing: docs, FAQs, product info
- **Organization private knowledge** — internal only: processes, playbooks, policies

---

## How It Works in the Framework

<!-- TODO: Detailed explanation of the integration architecture -->

- Connected as an MCP server via `getMemoryEngineMcpTools()` in `tools.ts`
- Memory Agent (`memory-agent.ts`) is the sub-agent that orchestrates memory operations
- Two modes: `user` (read all, write personal only) and `orgOwner` (read all, write all)
- Main agent calls `call_memory_agent` tool to delegate memory tasks

---

## Available MCP Tools

<!-- TODO: Expand each with parameters, return types, and usage examples -->

| Tool | Description | Who can use |
|------|-------------|-------------|
| `memory-engine__search_memory_engine` | Search across all memory scopes | All users |
| `memory-engine__add_memory` | Store a personal user memory | All users |
| `memory-engine__add_oracle_knowledge` | Store org knowledge (public or private scope) | Org owners only |
| `memory-engine__delete_episode` | Remove a memory episode | Depends on scope |
| `memory-engine__delete_edge` | Remove a relationship between memories | Depends on scope |
| `memory-engine__clear` | Clear all memories | Depends on scope |

---

## Configuration

<!-- TODO: Show env vars and per-user header setup -->

```env
MEMORY_MCP_URL=https://your-memory-engine.com/mcp
```

Per-user headers are set automatically per request:
- `x-oracle-did` — the oracle's DID
- `x-room-id` — the user's Matrix room ID
- `x-user-did` — the user's DID

---

## User vs Org Owner Mode

<!-- TODO: Explain how main-agent.ts determines mode and passes it to createMemoryAgent() -->

The main agent determines the mode based on the user's relationship to the oracle entity. Standard users can only add personal memories. Org owners can add public/private organization knowledge.

---

## Memory Agent Prompts

<!-- TODO: Show key sections of knowledgeAgentPrompt and orgOwnerKnowledgeAgentPrompt -->

Key behaviors:
- **Always search before acting** — check existing memories before adding new ones
- **User mode:** read all scopes, write personal memories only
- **Org owner mode:** must confirm scope (public/private) before adding organization knowledge
- **Prefer precise, structured memories** over vague statements

---

## Practical Example

<!-- TODO: Step-by-step walkthrough: adding org knowledge, searching memories, user context flow -->

**Source files:**
- `apps/app/src/graph/agents/memory-agent.ts`
- `apps/app/src/graph/nodes/tools-node/tools.ts`
- `apps/app/src/graph/agents/main-agent.ts` (lines 196-201)
