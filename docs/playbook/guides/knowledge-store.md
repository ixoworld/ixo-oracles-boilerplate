# Guide: Knowledge Store — Memory Engine

> **What it does:** The Memory Engine gives your oracle persistent memory and knowledge across conversations — it remembers users, stores organizational knowledge, and retrieves relevant context automatically.

---

## How It Works

Your oracle uses the Memory Engine (via MCP) as its knowledge store. When a user sends a message, the Memory Agent searches for relevant memories and knowledge, then injects that context into the conversation. No database setup required — it's a managed service.

---

## What Gets Stored

The Memory Engine manages three scopes of knowledge:

| Scope | Who can access | Examples |
|-------|---------------|----------|
| **User memories** | Private to each user | Preferences, past conversations, personal context |
| **Organization public knowledge** | All users of your oracle | FAQs, product docs, how-to guides |
| **Organization private knowledge** | Org members only | Internal processes, policies, playbooks |

---

## Configuration

The Memory Engine is connected via two environment variables in your `apps/app/.env`:

```env
MEMORY_MCP_URL=https://your-memory-engine-url/mcp
MEMORY_ENGINE_URL=https://your-memory-engine-url
```

These are auto-filled by the CLI during setup.

> See [Environment Variables Reference](../reference/environment-variables.md) for the complete list.

---

## Using Knowledge in Conversations

Your oracle handles knowledge automatically — no code needed:

- **Remembering users:** The Memory Agent stores and retrieves personal context (identity, goals, recent activity) for each user.
- **Searching knowledge:** When a user asks a question, the oracle searches across all accessible scopes and uses what it finds.
- **Adding knowledge:** Org owners can tell the oracle to remember something, and it stores it in the appropriate scope.

### Example

**User:** "Remember that our brand color is #3B82F6."

The oracle stores this as organization knowledge. Next time anyone asks about brand colors, the oracle will know.

---

## Adding Knowledge as an Org Owner

Org owners can add knowledge in two scopes:

- **Public** — accessible to all users (customers, public)
- **Private** — internal only (team members)

The oracle will always ask to confirm the scope before storing:

> "Should this be public (accessible to customers) or private (internal only)?"

---

## Next Steps

- **[Memory Engine Guide](./memory-engine.md)** — deeper dive into memory features
- **[05 — Sub-Agents](../05-sub-agents.md)** — the Memory Agent that powers knowledge retrieval
- **[Environment Variables Reference](../reference/environment-variables.md)** — all config options
