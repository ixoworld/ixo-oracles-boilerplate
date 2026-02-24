# 02 — Project Structure: Know Your Codebase

> **What you'll learn:** The layout of a scaffolded oracle project, where key files live, and what each package does.

---

## Monorepo Layout

<!-- TODO: Full tree diagram of top-level directories -->

```
my-oracle/
├── apps/app/              # Main NestJS oracle application
├── packages/              # Shared @ixo/* packages
├── turbo.json             # Turborepo build configuration
├── pnpm-workspace.yaml    # Workspace definitions
└── docker-compose.yml     # Infrastructure services
```

---

## apps/app/ — The Oracle Application

### Key Files

<!-- TODO: Expand each with 2-3 sentences explaining purpose and key exports -->

- **`src/main.ts`** — Bootstrap sequence: NestJS factory, Matrix initialization, Swagger docs, graceful shutdown registration.
- **`src/app.module.ts`** — NestJS module tree with middleware pipeline (auth, subscription, rate limiting).
- **`src/config.ts`** — Zod-validated environment schema + `oracleConfig` object (your oracle's identity).
- **`src/graph/`** — The LangGraph core — agents, tools, middlewares, state, MCP config.
- **`src/messages/`** — REST controllers for sending/receiving messages.
- **`src/sessions/`** — Session CRUD operations.
- **`src/ucan/`** — UCAN authorization for MCP tool access.

---

## The Graph Directory

The heart of your oracle lives in `apps/app/src/graph/`:

<!-- TODO: Expand each section with code examples -->

### state.ts — Graph State

`MainAgentGraphState` Annotation with fields: `messages`, `userContext`, `config`, `client`, `browserTools`, `agActions`, `mcpUcanContext`, `editorRoomId`, `currentEntityDid`.

### agents/ — Agent Definitions

- `main-agent.ts` — orchestrator, composes sub-agents + tools into the graph
- `subagent-as-tool.ts` — `AgentSpec` interface + `createSubagentAsTool()` wrapper
- `memory-agent.ts`, `portal-agent.ts`, `firecrawl-agent.ts`, `domain-indexer-agent.ts`, `editor/editor-agent.ts`, `skills-agent/`

### nodes/chat-node/prompt.ts — System Prompt

The 700+ line system prompt template. Input variables: `APP_NAME`, `IDENTITY_CONTEXT`, `WORK_CONTEXT`, `GOALS_CONTEXT`, `INTERESTS_CONTEXT`, `RELATIONSHIPS_CONTEXT`, `RECENT_CONTEXT`, `TIME_CONTEXT`, `EDITOR_DOCUMENTATION`, `AG_UI_TOOLS_DOCUMENTATION`, `CURRENT_ENTITY_DID`, `SLACK_FORMATTING_CONSTRAINTS`.

### nodes/tools-node/tools.ts — Tool Definitions

Tool factory functions including `getMemoryEngineMcpTools()` and `getFirecrawlMcpTools()`.

### middlewares/ — Execution Guards

Safety guardrail, tool validation, token limiter.

### mcp.ts — MCP Server Configuration

`MCPConfigWithUCAN` object connecting external MCP tool servers, with optional UCAN authorization wrapping.

### index.ts — MainAgentGraph Class

Entry points: `sendMessage()`, `streamMessage()`, `getGraphState()`.

---

## Packages Overview

<!-- TODO: Add "When to use" column with practical guidance -->

| Package              | Scope                       | Purpose                                          | Default? |
| -------------------- | --------------------------- | ------------------------------------------------ | -------- |
| common               | `@ixo/common`               | AI services, session management, room management | Yes      |
| matrix               | `@ixo/matrix`               | E2E encrypted communication                      | Yes      |
| events               | `@ixo/events`               | SSE/WebSocket streaming                          | Yes      |
| data-store           | `@ixo/data-store`           | ChromaDB + PostgreSQL knowledge                  | Opt-in   |
| oracles-chain-client | `@ixo/oracles-chain-client` | Blockchain payments, claims                      | Yes      |
| oracles-client-sdk   | `@ixo/oracles-client-sdk`   | React hooks (useChat, etc.)                      | Opt-in   |
| slack                | `@ixo/slack`                | Slack bot integration                            | Opt-in   |

---

## Key Files You'll Edit

Ordered by frequency of customization:

<!-- TODO: Add code snippets showing the relevant section of each file -->

1. **`apps/app/src/config.ts`** — `oracleConfig` object (name, purpose, features, target users)
2. **`apps/app/src/graph/nodes/chat-node/prompt.ts`** — system prompt template
3. **`apps/app/src/graph/agents/main-agent.ts`** — agent composition + tool registration
4. **`apps/app/src/graph/nodes/tools-node/tools.ts`** — custom tool definitions
5. **`apps/app/src/graph/mcp.ts`** — MCP server connections
