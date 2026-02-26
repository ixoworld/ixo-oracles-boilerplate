# Knowledge Management

## Overview

Knowledge management in the IXO Oracles Framework is handled by the **Memory Engine** — a managed service that gives your oracle persistent memory and knowledge across conversations.

## How It Works

The Memory Engine connects to your oracle via MCP (Model Context Protocol). The Memory Agent automatically searches for relevant knowledge when a user sends a message and injects it into the conversation context.

## Knowledge Scopes

| Scope | Access | Use case |
|-------|--------|----------|
| **User memories** | Private to each user | Preferences, personal context, past interactions |
| **Organization public knowledge** | All users | FAQs, product docs, how-to guides |
| **Organization private knowledge** | Org members only | Internal processes, policies |

## Configuration

```env
MEMORY_MCP_URL=https://your-memory-engine-url/mcp
MEMORY_ENGINE_URL=https://your-memory-engine-url
```

## Related

- [Knowledge Store Guide](../playbook/guides/knowledge-store.md) — how to use knowledge in your oracle
- [Memory Engine Guide](../playbook/guides/memory-engine.md) — memory features deep dive
- [Sub-Agents](../playbook/05-sub-agents.md) — the Memory Agent that powers retrieval
