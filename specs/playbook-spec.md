# IXO Oracles Playbook — Spec & Implementation Plan

> **Status:** In Progress
> **Location:** `docs/playbook/` in `ixo-oracles-boilerplate`

---

## 1. Context & Goal

The playbook bridges two repos:

- **ixo-oracles-cli** — scaffolds projects, creates DIDs, registers Matrix accounts, generates `.env`
- **ixo-oracles-boilerplate** — runtime framework: NestJS + LangGraph + Matrix + IXO blockchain

Progressive guide from "install the CLI" to "deploy a production oracle with payments, knowledge, and Slack."

---

## 2. File Structure

```
docs/playbook/
├── 00-overview.md                     # What is an IXO Oracle, architecture, prerequisites
├── 01-quickstart.md                   # CLI install → running oracle (~15 min) ✅ COMPLETE
├── 02-project-structure.md            # Tour of scaffolded project, key files
├── 03-customize-your-oracle.md        # System prompt, oracleConfig, personality
├── 04-custom-tools.md                 # Building LangGraph tools
├── 05-sub-agents.md                   # AgentSpec pattern, composing sub-agents
├── 06-middlewares.md                  # Safety, validation, token limiting
├── 07-mcp-servers.md                  # Connecting external MCP tool servers
├── 08-deployment.md                   # Docker, production config, graceful shutdown
├── guides/
│   ├── memory-engine.md               # Memory Engine MCP — user memories, org knowledge
│   ├── knowledge-store.md             # @ixo/data-store — ChromaDB + PostgreSQL
│   ├── payments-and-claims.md         # @ixo/oracles-chain-client — escrow, claims, authz
│   ├── events-streaming.md            # @ixo/events — SSE/WebSocket streaming
│   ├── slack-integration.md           # @ixo/slack — Socket Mode bot
│   ├── client-sdk.md                  # @ixo/oracles-client-sdk — React hooks
│   └── matrix-deep-dive.md            # @ixo/matrix — E2E encryption, rooms, checkpoints
└── reference/
    ├── environment-variables.md       # Complete .env reference ✅ COMPLETE
    ├── cli-reference.md               # All CLI commands ✅ COMPLETE
    ├── state-schema.md                # MainAgentGraphState fields ✅ COMPLETE
    └── api-endpoints.md               # REST API surface ✅ COMPLETE
```

---

## 3. Implementation Status

### Complete

- `01-quickstart.md` — full prose with CLI walkthrough, code blocks, message flow
- `reference/environment-variables.md` — all vars from EnvSchema
- `reference/state-schema.md` — full MainAgentGraphState documentation
- `reference/api-endpoints.md` — all REST endpoints
- `reference/cli-reference.md` — all 7 CLI commands with prompts, validation, flows, env var breakdown, network URLs, troubleshooting

### Skeleton (headers + section outlines + TODO markers)

- All other files

---

## 4. Critical Source Files Reference

| File                | Path                                                          | Used In                      |
| ------------------- | ------------------------------------------------------------- | ---------------------------- |
| App config          | `apps/app/src/config.ts`                                      | 01, 02, 03, 08, ref/env-vars |
| Main agent          | `apps/app/src/graph/agents/main-agent.ts`                     | 02, 03, 04, 05, 06, 07       |
| Sub-agent pattern   | `apps/app/src/graph/agents/subagent-as-tool.ts`               | 05                           |
| Memory agent        | `apps/app/src/graph/agents/memory-agent.ts`                   | 05, guides/memory-engine     |
| System prompt       | `apps/app/src/graph/nodes/chat-node/prompt.ts`                | 02, 03                       |
| Tools               | `apps/app/src/graph/nodes/tools-node/tools.ts`                | 02, 04, guides/memory-engine |
| State               | `apps/app/src/graph/state.ts`                                 | 02, ref/state-schema         |
| MCP config          | `apps/app/src/graph/mcp.ts`                                   | 07                           |
| Middlewares         | `apps/app/src/graph/middlewares/*.ts`                         | 06                           |
| Messages controller | `apps/app/src/messages/messages.controller.ts`                | ref/api-endpoints            |
| Sessions controller | `apps/app/src/sessions/sessions.controller.ts`                | ref/api-endpoints            |
| Bootstrap           | `apps/app/src/main.ts`                                        | 01, 08                       |
| CLI init            | `ixo-oracles-cli/src/commands/init.command.ts`                | 01, ref/cli                  |
| CLI env generator   | `ixo-oracles-cli/src/utils/create-project-env-file.ts`        | 01, ref/env-vars             |
| CLI entity          | `ixo-oracles-cli/src/utils/entity.ts`                         | 01, ref/cli                  |
| CLI registration    | `ixo-oracles-cli/src/utils/account/simplifiedRegistration.ts` | 01                           |
| CLI network config  | `ixo-oracles-cli/src/utils/common.ts`                         | ref/cli                      |

---

## 5. Fill-in Order (Future Sessions)

1. `00-overview.md` + architecture diagram
2. `02-project-structure.md`
3. `03-customize-your-oracle.md`
4. `04-custom-tools.md`
5. `05-sub-agents.md`
6. `guides/memory-engine.md`
7. `guides/payments-and-claims.md`
8. `guides/client-sdk.md`
9. Remaining guides
10. Reference pages (can be partially auto-generated from source)
11. `06-middlewares.md`, `07-mcp-servers.md`, `08-deployment.md`

---

## 6. Verification Criteria

- [x] Quickstart CLI walkthrough matches actual prompts in `init.command.ts`
- [x] Env var names match `config.ts` EnvSchema
- [x] API endpoints match NestJS controllers
- [ ] Code examples reference actual function signatures from source
- [ ] Memory engine guide covers all 6 MCP tools
- [x] All file paths in the spec are accurate
- [x] Skeleton files cover every section listed in this spec
- [x] CLI reference covers all 7 commands with prompts, validation, and flows
- [x] CLI `.env` generation includes all EnvSchema required vars (fixed name mismatches)

---

## 7. Changelog

| Date       | Change                                                                                                                                                                                             | Files Modified                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-02-23 | Fixed CLI `.env` generation — added 15 missing required vars, fixed 3 name mismatches (`ORACLE_MNEMONIC`→`SECP_MNEMONIC`, `ENTITY_DID`→`ORACLE_ENTITY_DID`, `MATRIX_VAULT_PIN`→`MATRIX_VALUE_PIN`) | `ixo-oracles-cli/src/utils/create-project-env-file.ts` |
| 2026-02-23 | Wrote complete CLI reference — all 7 commands, prompts, validation rules, entity creation flow (11 steps), env var breakdown, network URLs, troubleshooting                                        | `docs/playbook/reference/cli-reference.md`             |
| 2026-02-23 | Updated quickstart Step 4 — new `.env` template reflecting complete CLI output                                                                                                                     | `docs/playbook/01-quickstart.md`                       |
