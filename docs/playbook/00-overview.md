# 00 — What is an IXO Oracle?

> **Purpose:** Set the mental model before writing any code.

---

## What is an IXO Oracle

An IXO Oracle is an AI agent built on four pillars:

<!-- TODO: Expand each pillar with 2-3 paragraphs -->

### Blockchain Identity
DID registered on the IXO chain, entity with metadata and pricing configuration.

### E2E Encrypted Communication
Matrix protocol — each user gets a private encrypted room with the oracle.

### AI Reasoning
LangGraph state machine with composable sub-agents and tools.

### API Layer
NestJS server with REST endpoints, SSE streaming, and WebSocket support.

---

## Architecture Diagram

[Open in Excalidraw](https://excalidraw.com/#json=Brm7GvZXiEmDJq6I2Nd4L,yoiyGDOnX3VfF9QXUlQnGQ)

<!-- Architecture: Client Layer → API Layer → AI Engine → Infrastructure -->

---

## What You'll Build

This playbook guides you through progressive milestones:

| Chapter | Outcome |
|---------|---------|
| [01 — Quickstart](./01-quickstart.md) | A running oracle that responds to messages |
| [03 — Customize](./03-customize-your-oracle.md) | An oracle with custom personality and behavior |
| [04 — Custom Tools](./04-custom-tools.md) | An oracle with custom tools (API calls, DB queries) |
| [05 — Sub-Agents](./05-sub-agents.md) | An oracle with specialized sub-agents |
| Guides | Add payments, memory, Slack, knowledge store, etc. |

---

## Prerequisites

- **Node.js 22+** — check `.nvmrc` for the exact version
- **pnpm 10+** — workspace-aware package manager
- **Docker** — for Redis, ChromaDB, PostgreSQL
- **IXO Mobile App** — for SignX blockchain authentication
- **OpenRouter API key** — for LLM access

---

## How to Read This Playbook

**Chapters 00–08** are meant to be read in order. Each builds on the previous.

**Guides** (`guides/`) are standalone add-ons — pick whichever you need after completing the quickstart.

**Reference** (`reference/`) pages are lookup material — environment variables, CLI commands, API endpoints, state schema.
