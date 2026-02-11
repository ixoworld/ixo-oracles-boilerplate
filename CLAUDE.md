# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IXO Oracles Framework - a monorepo for building Agentic Oracles on the IXO network. Combines LangGraph (AI conversation flows), Matrix (E2E encrypted communication), NestJS (API layer), and IXO blockchain integration.

## Build & Development Commands

```bash
# From root - workspace operations
pnpm install          # Install all dependencies
pnpm build            # Build all packages (dependencies resolved by turbo)
pnpm dev              # Start NestJS app in watch mode
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm format           # Prettier format

# From apps/app - app-specific commands
pnpm start:dev        # NestJS watch mode
pnpm db:up            # Start Docker services (Redis, PostgreSQL, ChromaDB, nginx)
pnpm db:down          # Stop Docker services
pnpm db:clean         # Remove Docker volumes
pnpm migrate          # Run database migrations
pnpm migrate:fresh    # Full DB reset + migrations
pnpm test:cov         # Test with coverage

# Run tests for a single package
pnpm test --filter @ixo/events
```

## Architecture

### Monorepo Structure

- **apps/app/** - Main NestJS oracle application
- **packages/** - Shared packages with `@ixo/` scope

### Core Packages

| Package | Purpose |
|---------|---------|
| `@ixo/common` | AI services, session management, room management, checkpointer interfaces |
| `@ixo/matrix` | Matrix client wrapper, encrypted room management |
| `@ixo/events` | SSE/WebSocket event streaming (`ToolCallEvent`, `RenderComponentEvent`, `BrowserToolCallEvent`) |
| `@ixo/data-store` | Knowledge management with ChromaDB (vector) + PostgreSQL (structured) |
| `@ixo/oracles-chain-client` | Blockchain operations, claims, payments, ECIES encryption |
| `@ixo/oracles-client-sdk` | React client SDK (`useChat()` hook) |
| `@ixo/slack` | Slack bot integration |

### LangGraph Architecture

The AI system is built on LangGraph with state-based conversation flows:

**State (`apps/app/src/graph/state.ts`):**
- `MainAgentGraphState` - Annotation-based state with `messages[]`, `userContext`, `config`, `client`, `browserTools`, `agActions`, `mcpUcanContext`

**Agents (`apps/app/src/graph/agents/`):**
- `main-agent.ts` - Orchestrator, creates the graph
- `memory-agent.ts` - Contextual memory retrieval
- `portal-agent.ts` - Web portal logic
- `firecrawl-agent.ts` - Web crawling
- `domain-indexer-agent.ts` - Domain analysis
- `editor/editor-agent.ts` - Content editing with BlockNote

**Tools (`apps/app/src/graph/nodes/tools-node/`):**
- Server-side LangGraph tools
- Browser tools (reverse calls for DOM/UI operations)
- Middlewares: `tool-validation-middleware.ts`, `safety-guardrail-middleware.ts`, `token-limiter-middleware.ts`

**Entry points (`apps/app/src/graph/index.ts`):**
- `MainAgentGraph.sendMessage()` - Invoke mode
- `MainAgentGraph.streamMessage()` - Stream mode with SSE
- `MainAgentGraph.getGraphState()` - Retrieve current state

### Communication Flow

```
User → Client SDK → Oracle API → LangGraph Engine → Matrix Storage
         ↑                                              ↓
         └──────────────── Response ───────────────────┘
```

- Each oracle has a Matrix account registered on blockchain
- Each user gets a private encrypted Matrix room
- First interaction must be through web portal (grants AuthZ permissions)
- Matrix/Slack clients connect after portal setup

### Data Persistence

1. **Checkpoints** - LangGraph state snapshots in SQLite, synced to Matrix on shutdown
2. **Knowledge** - ChromaDB for vectors, PostgreSQL for metadata
3. **Sessions** - Per-user chat sessions with Matrix room history

### Security Layers

- Matrix access token validation (`x-matrix-access-token` header)
- DID verification (`x-did` header)
- Subscription checking middleware
- UCAN-based MCP tool authorization
- Rate limiting (Throttler)

## Configuration

Environment variables are validated via Zod schema in `apps/app/src/config.ts`. Key categories:
- Matrix (base URL, tokens, recovery phrases)
- Database (PostgreSQL, ChromaDB, SQLite paths)
- LLM (OpenAI, OpenRouter APIs)
- Blockchain (RPC URL, mnemonics, network)

## Key Patterns

- **Singleton MatrixManager** - Single Matrix connection per oracle
- **Graceful shutdown** - Uploads checkpoints to Matrix before exit
- **Annotation-based state** - LangGraph best practice with reducers
- **Multi-client support** - Portal, Matrix, Slack with unified message processing
