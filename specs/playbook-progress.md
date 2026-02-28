# Playbook Progress Tracker

> **PURPOSE:** This file is the single source of truth for playbook work across sessions.
> Context resets between sessions. Read this FIRST, then `specs/playbook-spec-v2.md`.

---

## How to Use This File (for future sessions)

1. Read this file top to bottom
2. Find the current phase (first phase with incomplete tasks)
3. Pick the next "Not started" task in that phase
4. Read the "Approach Notes" for that task before writing
5. After completing a task, update this file: status → Done, add date + notes

---

## Spec & Planning

| Task | Status | Date | Notes |
|------|--------|------|-------|
| Initial playbook spec v1 | Done | 2026-02-23 | `specs/playbook-spec.md` (superseded by v2) |
| Revised spec v2 (skills-first, no-under-the-hood) | Done | 2026-02-24 | `specs/playbook-spec-v2.md` — THE master spec |
| Progress tracker + memory setup | Done | 2026-02-24 | This file + CLAUDE.md updated + memory/MEMORY.md |

---

## Phase 1 — Foundation

> Start here. These 3 files set the tone for everything else.

| # | File | Status | Date | Notes |
|---|------|--------|------|-------|
| 1 | `docs/playbook/00-overview.md` | Done | 2026-02-24 | Full rewrite: 30-sec pitch, 4 pillars (1-2 sentences each), ASCII architecture diagram, "What are Skills?" section with analogy + example, updated roadmap table (skills-first links), guides table, prerequisites, reading guide. |
| 2 | `docs/playbook/04-working-with-skills.md` | Done | 2026-02-25 | NEW file. Sections: what are skills, browsing/searching, AI sandbox (2 sentences), walkthrough (5-step usage example + combining skills), building first skill (SKILL.md template + folder structure + publishing), custom tools fallback (1 example). |
| 3 | `docs/playbook/guides/publish-your-first-oracle.md` | Done | 2026-02-25 | NEW file. End-to-end hero guide: scaffold → customize → add skill → test → deploy → register → share. Links to existing chapters, doesn't duplicate. Deployment section links to Ch08 (platform TBD). Troubleshooting section with 6 common issues. |

---

## Phase 2 — Core Chapters

> Start after Phase 1 is complete.

| # | File | Status | Date | Notes |
|---|------|--------|------|-------|
| 4 | `docs/playbook/02-project-structure.md` | Done | 2026-02-25 | Full rewrite: 3 sections — annotated folder tree with edit/don't-touch zones, oracleConfig field-by-field table, comprehensive cheat sheet (5 categories, 20+ entries). Skills-first framing. |
| 5 | `docs/playbook/03-customize-your-oracle.md` | Done | 2026-02-25 | Full rewrite: oracleConfig identity, system prompt customization, model selection via OpenRouter, 3 practical examples (customer support, research assistant, domain expert) with complete copy-paste configs. |
| 6 | `docs/playbook/05-sub-agents.md` | Done | 2026-02-25 | Full rewrite: what are sub-agents (2 sentences), built-in agents table (6 entries), custom Weather Agent example with full code, wiring steps in main-agent.ts. Skills vs tools vs sub-agents comparison table. |
| 7 | `docs/playbook/08-deployment.md` | Done | 2026-02-26 | Full rewrite: pre-deployment checklist, Docker build + compose (copy-paste), Fly.io 8-step walkthrough (volumes, secrets, health checks, GitHub Actions auto-deploy), network selection table, graceful shutdown, health check, Langfuse monitoring, update/redeploy flow. |

---

## Phase 3 — Guides & Reference

> Start after Phase 2 is complete.

| # | File | Status | Date | Notes |
|---|------|--------|------|-------|
| 8 | `docs/playbook/guides/building-and-publishing-skills.md` | Done | 2026-02-28 | NEW. Full guide: SKILL.md template with tips, supporting files, local testing, PR-based publishing to ixoworld/ai-skills, do's and don'ts. |
| 9 | `docs/playbook/reference/skills-registry-api.md` | Merged | 2026-02-28 | Merged into `reference/skills-and-sandbox-api.md` |
| 10 | `docs/playbook/reference/sandbox-api.md` | Merged | 2026-02-28 | Merged into `reference/skills-and-sandbox-api.md` |
| 11 | `docs/playbook/06-middlewares.md` | Done | 2026-02-25 | Full rewrite: 4 sections — what are middlewares (1 sentence), built-in middlewares table (4 entries), custom logging middleware example, how to register. Hooks table included. |
| 12 | `docs/playbook/07-mcp-servers.md` | Done | 2026-02-25 | Full rewrite: 4 sections — what is MCP (1 sentence), built-in connections table (4 entries), adding a new server (HTTP + command examples), UCAN permissions (1 sentence + config snippet). |
| 13 | `docs/playbook/guides/memory-engine.md` | Done | 2026-02-28 | Full rewrite: 3 knowledge scopes table, natural language usage examples (save/retrieve/org knowledge), 6 MCP tools table, user vs org owner mode, env vars. |
| 14 | `docs/playbook/guides/knowledge-store.md` | Removed | 2026-02-28 | Merged into memory-engine guide. |
| 15 | `docs/playbook/guides/payments-and-claims.md` | Done | 2026-02-28 | Full rewrite: two revenue streams (token usage + service claims), Mermaid flow diagram, code example for custom claim tool, DISABLE_CREDITS, AuthZ, env vars table. |
| 16 | `docs/playbook/guides/events-streaming.md` | Removed | 2026-02-28 | Infrastructure detail, not core to oracle building. |
| 17 | `docs/playbook/guides/slack-integration.md` | Removed | 2026-02-28 | Niche distribution channel, not core to oracle building. |
| 18 | `docs/playbook/guides/client-sdk.md` | Removed | 2026-02-28 | Separate concern from building the oracle itself. |
| 19 | `docs/playbook/guides/matrix-deep-dive.md` | Removed | 2026-02-28 | No deep dives — conflicts with playbook tone. |

---

## Already Complete (don't rewrite unless asked)

- `docs/playbook/01-quickstart.md` ✅ — may need minor skills mention later
- `docs/playbook/reference/cli-reference.md` ✅
- `docs/playbook/reference/environment-variables.md` ✅
- `docs/playbook/reference/state-schema.md` ✅
- `docs/playbook/reference/api-endpoints.md` ✅

---

## Open Questions (unresolved — ask user when relevant)

1. **Deployment platform** — ✅ Resolved: Fly.io. Ch08 updated with full Fly.io walkthrough. (2026-02-26)
2. **ai-skills contribution flow** — ✅ Resolved: PR-based. Fork `ixoworld/ai-skills`, add skill folder, open PR. (2026-02-28)
3. **Sandbox auth** — Is `capsules.skills.ixo.earth` public or authenticated? Affects skill testing docs.

---

## Writing Rules (binding contract — never break these)

1. **No under-the-hood details.** What it does + how to use it. Never how it's built.
2. **1-2 sentences or a diagram** for any "how it works" context. No more.
3. **Skills-first framing.** Skills are the main story, tools/agents are supporting cast.
4. **Non-technical tone.** Plain language, analogies, no jargon.
5. **Copy-paste ready.** Every code block should work as-is.
6. **Don't duplicate.** Link to existing complete docs instead of rewriting.
