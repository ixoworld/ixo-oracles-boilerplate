# Custom Skills — Design Plan

> **Status:** Draft v2 — planning only, no code yet.
> **Scope:** Allow a user (and the agent acting on their behalf) to create their own **private** skills alongside the verified public skills, scoped per-user.
> **Change vs v1:** dropped Matrix-based storage, dropped the create-tool / REST-endpoint debate, dropped a separate materialiser. Storage is just a sandbox folder; discovery wraps the existing `list_skills` tool; creation is "agent writes files with the tools it already has."

---

## 1. The Insight That Simplifies Everything

The sandbox **already persists `/workspace/`** across restarts. The *only* directory that gets blown away each session is `/workspace/skills/` (because the sandbox repopulates it from the public capsule registry).

Any other folder — for example `/workspace/user-skills/` — survives. So **the sandbox itself is the store**. No Matrix events, no encryption layer, no REST endpoint, no materialiser — the per-user sandbox is a per-user filesystem, and that's exactly what we need.

This collapses the whole feature down to three small changes:

1. Teach `list_skills` to also `ls /workspace/user-skills/` and merge the result.
2. Make `load_skill` a no-op for user skills (they're already on disk).
3. Tell the agent in the prompt: "to create a skill for the user, write files into `/workspace/user-skills/<slug>/`."

That's it. **No new tools** for create/delete — the agent already has `sandbox_write` and `exec` from the sandbox MCP, and it already knows what a skill looks like (SKILL.md + supporting files).

---

## 2. Recommendation (Decision)

**Extend the main agent. No new sub-agent. No new authoring tool. Wrap the existing `list_skills` / `search_skills`.**

- Custom skills are a *source* of skills, not a new *capability*. The main agent already runs the `find → load → read → exec → output` workflow (`prompt.ts:200-226`) — splitting it would just duplicate that.
- The existing prompt already has a slot for "user-uploaded skills, highest priority" (`prompt.ts:169`). We just have to make the discovery tools actually return them.
- Authoring belongs to the agent: it has the sandbox tools, and a SKILL.md is just a markdown file.

---

## 3. Architecture

```mermaid
graph LR
    LG[LangGraph Agent] -- "list_skills" --> ST[skills-tools.ts]
    ST -- "fetch capsules" --> R[Public registry<br/>capsules.skills.ixo.earth]
    ST -- "exec ls + cat" --> SB[Sandbox MCP]
    SB --> US[/workspace/user-skills/]
    ST -- "cache by user DID" --> C[(NestJS cache-manager)]
    LG -- "sandbox_write to<br/>/workspace/user-skills/" --> SB
    LG -- "read_skill / exec" --> SB
```

**Two moving parts only:**

1. **Discovery** — `list_skills` / `search_skills` get extended to query the sandbox folder in parallel with the public registry, then merge with a `source` discriminator. Sandbox-side results are cached per-user.
2. **Convention** — `/workspace/user-skills/<slug>/` is the agreed location. Documented in the prompt; the agent treats it as a write target for new skills and a read source for existing ones.

---

## 4. Storage: just a sandbox folder

```
/workspace/
  uploads/         # read-only, existing  (user uploads)
  skills/          # read-only, existing  (public skills, repopulated each session)
  user-skills/     # NEW                  (custom skills, persists across sessions)
    <slug>/
      SKILL.md     # required
      ...other files (scripts, templates, examples)
  data/output/     # existing
```

Properties we get for free:

- **Per-user isolation** — already enforced by the sandbox service (each user ↔ oracle pair has its own sandbox instance).
- **Persistence** — the sandbox already keeps `/workspace/` between sessions. We do nothing extra.
- **No new keys / encryption surface** — sandbox-level encryption-at-rest already covers it (whatever the sandbox provides; same posture as `/workspace/uploads/`).

The agent reads, writes, and deletes through the same sandbox MCP tools it already has access to (`sandbox_write`, `exec`, `read_skill`).

---

## 5. Discovery: extend `list_skills` and `search_skills`

These two tools live in `apps/app/src/graph/nodes/tools-node/skills-tools.ts`. Today they're standalone async functions wrapped in `tool(...)`. We need them to:

1. Continue calling the public capsule registry (existing behaviour).
2. **Also** query the per-user sandbox for `/workspace/user-skills/*`.
3. Merge results, with user skills first.
4. Cache the sandbox query per user so repeated calls don't hammer the sandbox.

### Tool factory change

The tools currently have no access to the sandbox MCP client or cache manager. We convert them to factories built inside `createMainAgent`, where both are already in scope:

```ts
// skills-tools.ts
export function createListSkillsTool(deps: {
  sandboxMCP?: MCPClient;
  cache: Cache;
  userDid: string;
}) { return tool(async (params) => { /* merged listing */ }, { name: 'list_skills', ... }); }

export function createSearchSkillsTool(deps: { /* same */ }) { ... }
```

`main-agent.ts` (around lines 230–246 where `sandboxMCP` is built, and 792 where tools are added) constructs them once per agent invocation.

### Sandbox-side listing

The sandbox MCP's `exec` tool gives us shell access. One call is enough:

```bash
# Returns slug + first 5 lines of each SKILL.md (description usually lives there)
for d in /workspace/user-skills/*/; do
  if [ -f "$d/SKILL.md" ]; then
    slug=$(basename "$d")
    echo "::SLUG::$slug"
    head -20 "$d/SKILL.md"
    echo "::END::"
  fi
done 2>/dev/null
```

Parse the output server-side, derive `{ slug, description, path }` per entry. If the directory doesn't exist, the loop produces nothing — empty list, not an error.

### Cache

Use the existing NestJS `cache-manager` instance (already wired for `SecretsService`).

- **Key:** `user-skills:list:<userDid>`
- **TTL:** 5 minutes — short enough to feel fresh, long enough to absorb tight `list_skills` loops.
- **Invalidation:**
  - Explicit `refresh: boolean` parameter on `list_skills` / `search_skills` — the agent passes `refresh: true` immediately after creating or deleting a user skill (taught via prompt).
  - On TTL expiry. We don't try to detect agent-side `sandbox_write` calls; the prompt rule is simpler and more reliable.

### Return shape

Existing shape, with one new field:

```ts
type SkillEntry = {
  title: string;          // existing
  description: string;    // existing
  path: string;           // existing — for user skills: /workspace/user-skills/<slug>
  cid?: string;           // optional — only set for public skills
  source: 'user' | 'public'; // NEW
  createdAt?: string;     // existing
};
```

Public skills always have `cid`; user skills never do. The prompt teaches the agent that user skills are loaded by path, not CID.

### Ordering

User skills come first in the merged array. Combined with the prompt's "user skills have highest priority" rule (`prompt.ts:169`), this gives the agent a strong default without us having to add ranking logic.

---

## 6. Loading: `load_skill` becomes a no-op for user skills

`load_skill` today is a sandbox MCP tool that takes a CID, downloads the public capsule, and unpacks it into `/workspace/skills/`. For user skills there's nothing to download — the files are already on disk.

Two options:

- **A. Wrap `load_skill` server-side** so that if the agent passes a user-skill identifier, we short-circuit and return success.
- **B. Don't wrap. Tell the agent in the prompt: "user skills are pre-loaded — skip `load_skill` and go straight to `read_skill`."**

**Recommended: B.** Wrapping `load_skill` means intercepting an MCP tool we don't own (it lives in the sandbox MCP server, exposed by name). Cleaner to not interpose. The agent already follows prompt-level rules; one more line ("for `source: 'user'`, skip step 2 of the canonical workflow") is enough.

If we later find the agent reflexively calling `load_skill` on a path/slug and getting confusing errors, we can revisit and add a thin wrapper that intercepts.

---

## 7. Creation & deletion: no new tools

### Creating a skill

The agent already has, via the sandbox MCP:

- `sandbox_write(path, content)` — write any file
- `exec(command)` — run shell commands (mkdir, chmod, etc.)

A skill is a folder with a SKILL.md and optional supporting files. The agent can author all of that with the tools above. We add prompt instructions:

> **Creating a skill for the user**
>
> When the user asks to create a new skill (or you decide one would help future tasks):
> 1. Pick a slug: lowercase, hyphenated, unique under `/workspace/user-skills/`. Check with `list_skills` first.
> 2. `sandbox_write` to `/workspace/user-skills/<slug>/SKILL.md` — required. Follow the same SKILL.md format as public skills.
> 3. Add supporting files (scripts, templates) under the same folder as needed.
> 4. Call `list_skills` with `refresh: true` so the new skill shows up in subsequent listings.
> 5. Confirm to the user with the slug + a one-line summary.

### Deleting a skill

Agent uses `exec('rm -rf /workspace/user-skills/<slug>')`, then `list_skills` with `refresh: true`. Documented in the same prompt section.

### Updating

Same as creating — overwrite SKILL.md or replace files via `sandbox_write`. No version tracking in v1.

### Why no `create_user_skill` tool

- Zero new server code to maintain.
- The agent already has the right primitives, and the SKILL.md format is markdown the LLM is good at.
- A typed `create` tool would either (a) duplicate `sandbox_write` (pointless) or (b) try to be opinionated about structure, which constrains what kinds of skills users can build.

---

## 8. Agent prompt changes

In `apps/app/src/graph/nodes/chat-node/prompt.ts`:

1. **Skills section (~line 160–198):**
   - Replace the description of skills as "from the registry" with a two-source model: public (from registry) and user (from `/workspace/user-skills/`).
   - Spell out that `list_skills` / `search_skills` returns both, with `source: 'user' | 'public'`, and that user skills come first.
   - Make line 169's "highest priority" promise concrete: "If a user skill matches the request, prefer it over a public skill, even if both apply."

2. **Canonical workflow (lines 200–226):**
   - Branch step 2 (Load): for `source: 'public'`, call `load_skill(cid)`. For `source: 'user'`, skip — the skill is already on disk.
   - Step 3 (Read): same `read_skill` call works for both, just use the path from the listing.

3. **Sandbox file system (lines 265–280):**
   - Add `/workspace/user-skills/` to the list. Mark it as **read/write** (unlike `/workspace/skills/` which is read-only).
   - Note: "User skills persist across sessions — anything you write here stays for next time."

4. **New "Creating skills" subsection** as described in §7.

5. **Cache hygiene rule:** "After `sandbox_write` or `exec rm` under `/workspace/user-skills/`, your next `list_skills` call must include `refresh: true`."

---

## 9. Implementation plan (ordered, no work begins until approved)

| # | Step | Files touched |
| - | ---- | ------------- |
| 1 | Convert `listSkillsTool` / `searchSkillsTool` to factories that take `{ sandboxMCP, cache, userDid }`. Keep the public-registry path identical. | `apps/app/src/graph/nodes/tools-node/skills-tools.ts` |
| 2 | Add sandbox-side listing helper (single `exec` call, parser, error-tolerant when `/workspace/user-skills/` is missing). | same file |
| 3 | Add cache read/write keyed on user DID; add `refresh` param to both tools. | same file |
| 4 | Wire factories into `createMainAgent` — pass `sandboxMCP`, the existing `cacheManager`, and `configurable.configs.user.did`. | `apps/app/src/graph/agents/main-agent.ts` (around tool list ~line 792) |
| 5 | Update agent prompt: two-source model, branch on `source`, `/workspace/user-skills/` in filesystem section, new "Creating skills" subsection, refresh-after-write rule. | `apps/app/src/graph/nodes/chat-node/prompt.ts` (lines 160–280) |
| 6 | Tests: tool returns merged result, cache hits/misses, `refresh: true` busts cache, missing folder yields empty. Mock the sandbox MCP `exec` response. | `apps/app/src/graph/nodes/tools-node/skills-tools.spec.ts` |
| 7 | Docs: update `docs/playbook/04-working-with-skills.md` "Building Your First Skill" section to describe the in-chat flow. Update `specs/playbook-progress.md`. | docs only |

All of this ships as one small PR. No new module, no new service, no new controller, no DB migration.

---

## 10. Open questions (flag before build)

1. **Sandbox-folder persistence — confirm.** I'm taking it on the user's word that `/workspace/` (everything except `/workspace/skills/`) survives sandbox restarts. Quick smoke test against the actual ai-sandbox service before merging step 1: write a marker file, restart, look for it. If persistence is per-session-only, the whole plan collapses.
2. **Sandbox-side listing performance.** A `find` / shell loop over `/workspace/user-skills/` is fine for tens of skills. If a user accumulates hundreds, parsing becomes the bottleneck, not the FS. We're well below that ceiling for v1.
3. **Cross-oracle sharing.** A user with two different oracles has two different sandboxes — so user skills don't cross. Probably fine (each oracle is its own context); flag if product wants a cross-oracle "skill library."
4. **Validation.** The agent is the only writer, so SKILL.md schema, slug uniqueness, and file-size limits aren't enforced anywhere. v1 trusts the LLM. If we see garbage skills accumulating, add a server-side `list_skills`-time validator that hides malformed entries (instead of blocking writes).
5. **Public-vs-user collisions.** What if a user creates a skill named `pptx` and a public skill `pptx` also exists? Our merged list shows both with `source` flags; the agent prefers the user one per the priority rule. No collision logic needed — the `source` field is the tie-breaker.

---

## 11. Non-goals (v1)

- No publishing user skills back to the public registry.
- No versioning — overwrite-in-place semantics.
- No cross-oracle/cross-user sharing.
- No UI in the Portal for managing skills (Portal team handles separately if desired).
- No server-side authoring API. The agent does it in chat.
