# Guide: Memory Engine

> **What you'll learn:** How your oracle remembers things across conversations using the Memory Engine.

---

## What It Does

The Memory Engine gives your oracle persistent memory. It remembers user preferences, organization knowledge, and context from past conversations — so users don't have to repeat themselves.

---

## Three Knowledge Scopes

Your oracle organizes memories into three scopes:

| Scope                       | What it stores                               | Who can access it       |
| --------------------------- | -------------------------------------------- | ----------------------- |
| **User memories** (private) | Personal preferences, past requests, context | Only that specific user |
| **Organization public**     | Customer-facing docs, FAQs, product info     | All users               |
| **Organization private**    | Internal processes, policies, playbooks      | Internal members only   |

---

## How to Use It

You don't need to configure anything special — just talk to your oracle naturally.

**Saving memories:**

```
You: "Remember that I prefer dark mode and weekly reports on Mondays"
Oracle: Got it — I'll remember your preferences.
```

**Adding organization knowledge (org owners only):**

```
You: "Add this to the knowledge base: Our refund policy is 30 days, no questions asked"
Oracle: Should this be public (accessible to customers) or private (internal only)?
You: "Public"
Oracle: Added to public knowledge.
```

**Retrieving memories:**

```
You: "What do you know about me?"
Oracle: I know you prefer dark mode and like weekly reports on Mondays.

You: "What's our refund policy?"
Oracle: Your refund policy is 30 days, no questions asked.
```

Your oracle automatically searches its memory at the start of each conversation to pull in relevant context.

---

## Available Tools

These are the tools the Memory Engine provides. Your oracle uses them automatically — you just talk naturally.

| Tool                   | What it does                                           |
| ---------------------- | ------------------------------------------------------ |
| `search_memory_engine` | Searches across all memory scopes for relevant context |
| `add_memory`           | Saves a personal memory for the current user           |
| `add_oracle_knowledge` | Adds organization knowledge (org owners only)          |
| `delete_episode`       | Removes a specific memory                              |
| `delete_edge`          | Removes a relationship between memories                |
| `clear`                | Clears all memories (use with caution)                 |

---

## User vs Org Owner Mode

Regular users can save personal memories and search all scopes. Org owners can also add organization knowledge (both public and private). When an org owner adds organization knowledge, the oracle always confirms the scope — public or private — before saving.

---

## Configuration

| Variable            | Description                         |
| ------------------- | ----------------------------------- |
| `MEMORY_MCP_URL`    | URL of the Memory Engine MCP server |
| `MEMORY_ENGINE_URL` | URL of the Memory Engine API        |

See [Environment Variables](../reference/environment-variables.md) for the full list.
