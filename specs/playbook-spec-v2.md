# IXO Oracles Playbook — Revised Spec v2

> **Goal:** A playbook that enables both AI agents and non-technical humans to build, customize, and deploy IXO Oracles.
> **Key Shift:** Agents are now skill-based. Skills are the building blocks. The [ai-skills](https://github.com/ixoworld/ai-skills) registry + [ai-sandbox](https://github.com/ixoworld/ai-sandbox) are first-class concepts.

---

## Guiding Principles

1. **Non-technical friendly** — Assume the reader has no backend/blockchain experience. Use plain language, analogies, and diagrams.
2. **AI-readable** — Structure content so an AI agent (Claude, GPT, etc.) can follow the playbook to scaffold and configure an oracle autonomously.
3. **Skills-first** — Skills are the primary extension mechanism. Tools, sub-agents, and MCP servers are implementation details underneath.
4. **Progressive disclosure** — Start with a running oracle in minutes, then layer on complexity chapter by chapter.
5. **Copy-paste ready** — Every chapter includes working code snippets and CLI commands that can be executed as-is.
6. **No under-the-hood details** — Never explain how the underlying technology works in depth. The reader needs to know *what* things do and *how to use* them, not *how they're built*. For any "how it works" context, limit to 1-2 sentences or a simple diagram. No implementation internals, no protocol specs, no deep architecture. Keep it practical: "This is what it does. Here's how you use it." This is a **binding contract** for all current and future spec/content work.

---

## Part 1: Core Chapters (sequential, build on each other)

### Chapter 00 — What is an IXO Oracle?

**Audience:** Complete beginner, first contact with the project.

**Subsections:**
- 00.1 — **The 30-second pitch**: What oracles do in plain English (AI assistant with blockchain identity, encrypted messaging, and extensible skills)
- 00.2 — **The four pillars** (1-2 sentences each, no internals):
  - Blockchain Identity — your oracle has a DID, like a passport on-chain
  - E2E Encrypted Communication — every conversation is private and encrypted
  - AI Reasoning — your oracle thinks step by step and uses skills to get things done
  - API Layer — a server that connects everything together
- 00.3 — **Architecture diagram** — one simple visual (Client → Oracle → Skills/Blockchain/Matrix). No protocol details.
- 00.4 — **What are Skills?** — 1 paragraph + example:
  - Skills = reusable knowledge packages your oracle can use (like apps on a phone)
  - Example: "there's a skill for creating presentations, one for generating PDFs, etc."
  - You can use existing skills or publish your own
- 00.5 — **What you'll build** — roadmap table linking each chapter to an outcome
- 00.6 — **Prerequisites** — Node 22+, pnpm 10+, Docker, IXO Mobile App, OpenRouter API key

**Status:** Skeleton exists, needs full rewrite with skills context.

---

### Chapter 01 — Quickstart (~15 min)

**Audience:** Anyone ready to get their hands dirty.

**Subsections:**
- 01.1 — Install the CLI (`npm i -g ixo-oracles-cli`)
- 01.2 — Scaffold a new oracle (`oracles-cli --init`) — walkthrough of every prompt
- 01.3 — Understand what was generated (brief file tree, point to Ch02 for deep dive)
- 01.4 — Configure environment (`.env` file walkthrough)
- 01.5 — Start infrastructure (`pnpm db:up`)
- 01.6 — Run the oracle (`pnpm dev`)
- 01.7 — Send your first message (curl example + expected response)
- 01.8 — What just happened? (message flow diagram: User → API → LangGraph → Matrix → Response)

**Status:** COMPLETE ✅ — may need minor updates to mention skills.

---

### Chapter 02 — Project Structure Tour

**Audience:** Someone who completed quickstart, wants to understand what they're looking at.

**Subsections:**
- 02.1 — **Folder overview** — annotated tree, "what to edit" vs "don't touch". No architecture explanation.
- 02.2 — **The config file** — what each field in `oracleConfig` does (plain English)
- 02.3 — **Key files cheat sheet** — the hero section. Table: "I want to X → edit this file". This is what people will come back to.

**Status:** Skeleton exists, needs full prose.

---

### Chapter 03 — Customize Your Oracle

**Audience:** Someone who wants to change what their oracle says and does.

**Subsections:**
- 03.1 — **Oracle identity** — editing `oracleConfig` (appName, appPurpose, appMainFeatures, appTargetUsers, appUniqueSellingPoints)
- 03.2 — **System prompt** — how `prompt.ts` works, what variables are injected, how to modify personality
- 03.3 — **Model selection** — switching LLM providers via OpenRouter
- 03.4 — **Quick wins** — 3 practical examples:
  - Example A: Customer support oracle
  - Example B: Research assistant oracle
  - Example C: Domain-specific expert oracle

**Status:** Skeleton exists, needs full prose + examples.

---

### Chapter 04 — Working with Skills

**Audience:** Someone who wants their oracle to DO things (create documents, process data, generate images).

> **This is a NEW chapter replacing the old "Custom Tools" chapter.** Skills are now the primary extension point.

**Subsections:**
- 04.1 — **What are skills?** — a skill is a folder with a `SKILL.md` instruction file + optional supporting files. Your oracle reads the instructions and follows them. One simple diagram showing: User asks → Oracle finds skill → Reads instructions → Executes → Returns result.
- 04.2 — **Browsing & searching skills** — show the reader how to ask the oracle to list/search skills. No API internals, just "your oracle can browse a registry of skills."
- 04.3 — **The AI Sandbox** — 2 sentences: "Skills run in a secure sandbox. Your oracle writes output files there and can return them to the user." No Cloudflare/R2/FUSE details.
- 04.4 — **Using existing skills** — hands-on walkthrough:
  - Ask your oracle to find a skill (e.g., "create a presentation")
  - Watch it discover, load, and execute the skill
  - Get the output file
- 04.5 — **Building your first skill**
  - Create a `SKILL.md` file (with template)
  - Add any supporting files
  - Publish to the [ai-skills registry](https://github.com/ixoworld/ai-skills)
- 04.6 — **Custom tools** (brief — for when skills aren't enough)
  - When to use a tool vs a skill (1 paragraph)
  - One copy-paste example
  - Link to Ch05 for more

**Status:** NEW — replaces old `04-custom-tools.md`.

---

### Chapter 05 — Sub-Agents & Composition

**Audience:** Someone building a complex oracle with multiple capabilities.

**Subsections:**
- 05.1 — **What are sub-agents?** — 2 sentences: "Your oracle can delegate tasks to specialist agents. Think of them as team members with different skills."
- 05.2 — **Built-in sub-agents** — table with name + what it does (1 line each). No architecture details.
- 05.3 — **Creating a custom sub-agent** — copy-paste template with one practical example
- 05.4 — **Wiring it up** — show where to register your sub-agent (point to the file, show the one line to add)

**Status:** Skeleton exists, needs full prose.

---

### Chapter 06 — Middlewares & Safety

**Audience:** Someone preparing their oracle for real users.

**Subsections:**
- 06.1 — **What are middlewares?** — 1 sentence: "Code that runs before/after every tool call — for safety, validation, and billing."
- 06.2 — **Built-in middlewares** — table: name + what it does (1 line each)
- 06.3 — **Writing a custom middleware** — one copy-paste example (e.g., logging)
- 06.4 — **Adding it to your oracle** — point to the file, show the one line to add

**Status:** Skeleton exists, needs full prose.

---

### Chapter 07 — MCP Servers (External Tool Servers)

**Audience:** Someone who wants to connect external services.

**Subsections:**
- 07.1 — **What is MCP?** — 1 sentence: "A way to plug external tools into your oracle, like connecting apps to a phone."
- 07.2 — **Built-in connections** — table: name + what it gives your oracle (1 line each)
- 07.3 — **Adding a new MCP server** — copy-paste config example, point to `mcp.ts`
- 07.4 — **Permissions** — 1 sentence on UCAN ("each user gets their own permissions for external tools")

**Status:** Skeleton exists, needs full prose.

---

### Chapter 08 — Deployment & Going Live

**Audience:** Someone ready to ship their oracle to production.

> **Key addition: Railway / Fly.io deployment guides.**

**Subsections:**
- 08.1 — **Pre-deployment checklist** — bullet list of what you need ready before deploying
- 08.2 — **Deploy with Docker** (self-hosted) — copy-paste commands, no Docker internals
- 08.3 — **Deploy to Railway** *(new)* — step-by-step with screenshots/commands
- 08.4 — **Deploy to Fly.io** *(new)* — step-by-step with commands
- 08.5 — **After deployment** — health check, graceful shutdown (1 sentence: "your oracle saves its state before shutting down"), updating/redeploying

**Status:** Skeleton exists, needs full rewrite with deployment platform guides.

---

## Part 2: Guides (standalone, pick what you need)

Each guide is independent. Reader only needs to have completed Chapter 01 (Quickstart).

### Guide: Publish Your First Oracle *(NEW)*

> **This is the marquee guide — the "hello world to production" path for non-technical users.**

**Subsections:**
- G.pub.1 — **What you'll build** — a simple assistant oracle with 1-2 skills
- G.pub.2 — **Step 1: Scaffold** — use CLI to create project
- G.pub.3 — **Step 2: Customize** — edit oracleConfig for your use case
- G.pub.4 — **Step 3: Add a skill** — pick a skill from the registry, test it locally
- G.pub.5 — **Step 4: Test locally** — send messages, verify skill execution
- G.pub.6 — **Step 5: Deploy** — push to Railway or Fly.io (simplified from Ch08)
- G.pub.7 — **Step 6: Register on-chain** — use CLI to register the oracle entity
- G.pub.8 — **Step 7: Share it** — get the oracle URL, invite users
- G.pub.9 — **Troubleshooting** — common issues and fixes

**Status:** NEW — needs to be written from scratch.

---

### Guide: Building & Publishing Skills *(NEW)*

> **For people who want to contribute skills to the ecosystem.**

**Subsections:**
- G.skills.1 — **What's in a skill** — SKILL.md + supporting files. Show a real example.
- G.skills.2 — **Writing your SKILL.md** — template + tips for clear instructions
- G.skills.3 — **Adding supporting files** — when and why (scripts, templates, examples)
- G.skills.4 — **Testing your skill** — how to verify it works before publishing
- G.skills.5 — **Publishing** — submit to [ai-skills repo](https://github.com/ixoworld/ai-skills), step-by-step
- G.skills.6 — **Tips for good skills** — practical do's and don'ts (no "design patterns" jargon)

**Status:** NEW — needs to be written from scratch.

---

### Guide: Memory Engine
- What it does (1 sentence), how to enable it (env vars), what your oracle can remember. No MCP protocol details.
- **Status:** Partial content exists, needs completion.

### Guide: Knowledge Store
- What it does (1 sentence), how to add documents, how to query them. No vector DB internals.
- **Status:** Skeleton exists.

### Guide: Payments & Claims
- What it does (1 sentence), how to set up pricing, how users pay. No escrow protocol details.
- **Status:** Skeleton exists.

### Guide: Events & Streaming
- What it does (1 sentence), how to stream responses to users. One example.
- **Status:** Skeleton exists.

### Guide: Slack Integration
- How to connect your oracle to Slack. Step-by-step setup.
- **Status:** Skeleton exists.

### Guide: Client SDK (React)
- How to build a chat UI for your oracle. `useChat()` hook + one example.
- **Status:** Skeleton exists.

### Guide: Matrix Deep Dive
- For advanced users only. How encrypted messaging works (brief), troubleshooting connectivity.
- **Status:** Skeleton exists.

---

## Part 3: Reference (lookup material)

### reference/cli-reference.md
All 7 CLI commands with prompts, validation, flows, network URLs.
**Status:** COMPLETE ✅

### reference/environment-variables.md
All EnvSchema vars with descriptions.
**Status:** COMPLETE ✅

### reference/state-schema.md
MainAgentGraphState fields.
**Status:** COMPLETE ✅

### reference/api-endpoints.md
All REST endpoints.
**Status:** COMPLETE ✅

### reference/skills-registry-api.md *(NEW)*
The capsules API: `GET /capsules`, `GET /capsules/search`, capsule schema, CID system.
**Status:** NEW — needs to be written.

### reference/sandbox-api.md *(NEW)*
AI Sandbox API: `POST /sandbox/run/{id}`, `POST /artifacts/`, artifact retrieval, R2 storage.
**Status:** NEW — needs to be written.

---

## File Structure (revised)

```
docs/playbook/
├── 00-overview.md                        # What is an IXO Oracle + Skills intro
├── 01-quickstart.md                      # CLI → running oracle (~15 min)     ✅
├── 02-project-structure.md               # Tour of scaffolded project
├── 03-customize-your-oracle.md           # Personality, system prompt, model
├── 04-working-with-skills.md             # ★ NEW — Skills + Sandbox + building skills
├── 05-sub-agents.md                      # AgentSpec, composition
├── 06-middlewares.md                     # Safety, validation, token limiting
├── 07-mcp-servers.md                     # External tool servers
├── 08-deployment.md                      # Docker + Railway + Fly.io
├── guides/
│   ├── publish-your-first-oracle.md      # ★ NEW — End-to-end beginner path
│   ├── building-and-publishing-skills.md # ★ NEW — Skill creation + registry
│   ├── memory-engine.md                  # Memory Engine MCP
│   ├── knowledge-store.md               # Memory Engine knowledge store
│   ├── payments-and-claims.md           # Escrow, claims, AuthZ
│   ├── events-streaming.md              # SSE/WebSocket
│   ├── slack-integration.md             # Slack bot
│   ├── client-sdk.md                    # React hooks
│   └── matrix-deep-dive.md             # E2E encryption, rooms
└── reference/
    ├── cli-reference.md                  ✅
    ├── environment-variables.md          ✅
    ├── state-schema.md                   ✅
    ├── api-endpoints.md                  ✅
    ├── skills-registry-api.md            # ★ NEW
    └── sandbox-api.md                    # ★ NEW
```

---

## Key Changes from v1

| What Changed | Why |
|---|---|
| Ch04 renamed from "Custom Tools" → "Working with Skills" | Skills are the primary extension mechanism, tools are secondary |
| New guide: "Publish Your First Oracle" | End-to-end path for non-technical users, the most important new content |
| New guide: "Building & Publishing Skills" | ai-skills ecosystem needs its own guide |
| Ch08 expanded with Railway + Fly.io | Deployment needs to be accessible, not just Docker |
| New references: skills-registry-api, sandbox-api | Skills + Sandbox are new core concepts that need lookup docs |
| Tone shift throughout | Non-technical friendly, AI-readable, plain language |

---

## Implementation Priority

### Phase 1 — Foundation (do first)
1. `00-overview.md` — rewrite with skills context
2. `04-working-with-skills.md` — NEW, core concept
3. `guides/publish-your-first-oracle.md` — NEW, the hero guide

### Phase 2 — Core chapters
4. `02-project-structure.md` — full prose
5. `03-customize-your-oracle.md` — full prose + examples
6. `05-sub-agents.md` — full prose
7. `08-deployment.md` — add Railway + Fly.io sections

### Phase 3 — Guides & Reference
8. `guides/building-and-publishing-skills.md` — NEW
9. `reference/skills-registry-api.md` — NEW
10. `reference/sandbox-api.md` — NEW
11. Remaining guides (memory, knowledge, payments, etc.)
12. `06-middlewares.md`, `07-mcp-servers.md`

---

## Open Questions

1. **Deployment platform** — You mentioned Railway or Fly.io but still researching. We can write the section structure now and fill in platform-specific details once decided.
2. **ai-skills contribution flow** — Is there a PR-based flow to `ixoworld/ai-skills`? Or a CLI command to publish? Need to verify before writing the publishing guide.
3. **Sandbox access** — Is the sandbox at `capsules.skills.ixo.earth` publicly accessible, or does it require auth? This affects the skill testing guide.
