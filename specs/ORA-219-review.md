# ORA-219 Plugin-Based Runtime — Deep Review

**Reviews:** `specs/ORA-219-plugin-based-runtime.md` (PR #190)
**Reviewer:** Claude (codebase cross-check on commit `0ee7106`)
**Date:** 2026-05-05
**Scope:** What v1 must cover before merge — focused on testing depth, version-update DX, extend/reduce DX.

---

## TL;DR

The spec is **architecturally sound** and the three north-star goals are right. But several v1-critical sections are **underspecified or speculative**, and the gaps cluster on the things the author explicitly called out: **testing, version-update DX, and plug/unplug confidence**.

Concretely:

1. **Testing (§19) is one page for what is structurally the most important piece.** No LLM determinism strategy, no contract tests across plugins, no fixture/golden-output story, no plug-matrix CI. Plugin authors will write green tests that lie.
2. **Version-update DX (§23.4) is deferred.** Yet "easy to update framework versions" is goal A. We need a runtime-compatibility contract and a plugin-API stability tier in v1, not later.
3. **Plug/unplug (Goal C) doesn't survive contact with state.** Existing `userContext`, `mcpUcanContext`, `userPreferences`, `agActions`, `browserTools` are not plugin-prefixed and have no migration plan (§10.3 only covers *new* prefixed fields).
4. **`RuntimeContext` (§7) doesn't reach BullMQ workers.** Tasks/claim-processing/calls run jobs *outside* request context. The spec's `ctx.matrix`, `ctx.secrets`, `ctx.user` simply aren't available there.
5. **The 80-line `createMainAgent` (§14.1) is aspirational.** Today's `main-agent.ts` is 1,052 lines (not 904) and includes Promise.allSettled fallbacks for sub-agents, MCP client construction, UCAN minting, and conditional sub-agent init. The spec doesn't formalize how those move into plugin manifests.
6. **Event emission (§7.2 `ctx.emit`) presupposes a wiring that doesn't exist.** `GraphEventEmitter` binds to a Socket.IO server reference at gateway init; plugins have no access to it.
7. **Boot determinism + observability is missing.** No `qiforge inspect` output schema, no boot manifest dump, no telemetry contract. Forks will have no idea why a plugin is degraded.

The spec gives the agent a lot of polish (manifests, meta-tools, three tiers). It gives the operator/fork developer comparatively little — and the operator is the one upgrading versions weekly.

This document lists what to add for v1 to close the gaps, with concrete API and test signatures.

---

## Section A — Testing (Goal-blocking; must expand for v1)

The current §19 covers ~5% of what a plugin author actually needs. Test surface for a plugin-based runtime has six layers; the spec only addresses two.

### A.1 The six test layers (none in spec → all in v1)

| # | Layer | Today in spec | What v1 must add |
|---|---|---|---|
| 1 | **Unit (single tool/middleware)** | ✅ `rt.invokeTool` / `rt.invokeMiddleware` covered | OK as-is |
| 2 | **Plugin contract** | ❌ not addressed | Static + runtime contract checks: manifest valid, tool schemas Zod-parseable, no name collisions, every `examples[].tool` actually registered, soft-deps actually optional |
| 3 | **Plug-matrix (Goal C proof)** | Partially in §22.15 (5 boot tests) | Property-based: for any subset S ⊆ allPlugins, app boots, no crash, no collision, no broken state. CI matrix |
| 4 | **Cross-plugin integration** | ❌ silent | Two-plugin scenarios: tasks+memory soft-dep enrichment; credits+claim-processing hard-dep cascade; slack+messages event ordering |
| 5 | **Agent-level (LLM-in-the-loop)** | ❌ "heavier integration" mentioned, no detail | Deterministic LLM mocks (recorded fixtures + replay); tool-choice assertions; manifest-discovery assertions ("agent calls `find_capability` when uncertain") |
| 6 | **Boot/lifecycle** | Listed in §22.15 only as smoke checks | Health-check transitions (ready→degraded→ready), teardown ordering (reverse-topo), abort-signal propagation, env-validation error messages |

### A.2 Concrete additions to `createTestRuntime`

The spec's `createTestRuntime` API in §19.2 has 12 helpers. A workable v1 needs ~20. Add these:

```ts
interface TestRuntime {
  // ─── existing in spec ──────────────────────────────────────
  invokeTool(name: string, args: unknown): Promise<unknown>;
  invokeMiddleware(name: string, state: any, runtime: any): Promise<unknown>;
  runHealthCheck(plugin: string): Promise<HealthStatus>;
  listTools(plugin?: string): PluginTool[];
  getManifest(plugin: string): PluginManifest;
  listCapabilities(): Array<{name; summary; status; ...}>;
  findCapability(query: string): Array<{name; score; reason}>;
  invokeAgent(messages: BaseMessage[]): Promise<AgentResult>;

  // ─── ADD for v1 ────────────────────────────────────────────

  // Determinism / mocking
  useRecordedLLM(fixtureName: string): void;            // replay a recorded fixture
  recordLLM(fixtureName: string): () => Promise<void>;  // returns finalize() that writes the file
  clock: { advance(ms: number): void; setNow(d: Date): void }; // for scheduled jobs
  rng: { seed(n: number): void };                       // determinism for any plugin RNG

  // Health & status
  setHealth(plugin: string, status: HealthStatus): void;
  watchPromptChanges(): { changes: PromptDelta[]; stop(): void };

  // Plug-matrix helpers
  withPlugins<T>(subset: string[], fn: (rt: TestRuntime) => Promise<T>): Promise<T>;
  assertNoCollisions(): void; // throws with full report
  assertManifestExamplesValid(): void;

  // Lifecycle
  triggerSetup(plugin?: string): Promise<void>;
  triggerTeardown(plugin?: string): Promise<void>;
  abort(reason?: string): void; // simulate SIGTERM/abort signal

  // Streaming/events
  collectEvents(): { tool: ToolCallEvent[]; render: RenderComponentEvent[]; ... };
  expectEvent(predicate: (e: AnyEvent) => boolean, timeoutMs?: number): Promise<AnyEvent>;

  // BullMQ / async workers (covers Section C below)
  drainQueues(): Promise<void>;       // run all pending jobs to completion
  inspectQueue(name: string): JobSnapshot[];

  // Snapshots
  snapshotPrompt(): string;           // for golden-file tests
  snapshotRegistry(): RegistryDump;   // for "what loaded" assertions
}
```

These aren't optional polish. Without `useRecordedLLM`, `clock`, and `drainQueues`, the entire `tasksPlugin` and `memoryPlugin` are untestable in CI without flakiness or real LLM cost.

### A.3 LLM-determinism strategy (missing entirely)

The spec mentions `rt.useRealLLM()` once and otherwise hand-waves. Pick one of these for v1:

1. **Recorded fixtures (recommended).** First test run records LLM calls (request → response) to JSON. Subsequent runs replay. Keyed by hash of (model, messages, tools). Update via env var `RECORD_LLM=1`. Cheap, deterministic, reviewable in PRs.
2. **Stub-only.** `rt.mocks.llm.respondWith({...})` per test. Fast but fragile — every model change breaks tests.
3. **Cassettes via `nock` for HTTP.** Works for OpenAI direct but not for SDK-internal retries/streaming.

V1 should ship (1). Other Anthropic-style frameworks settled there for the same reasons.

### A.4 Plug-matrix as a property test, not five smoke tests

§22.15 lists five hand-picked scenarios (A–E). For 15 bundled plugins, 2^15 = 32,768 subsets — clearly can't run all. But we can run:

- **All single-plugin boots** (15 cases).
- **All pairwise boots** (105 cases).
- **Hard-dep closure boots** for every bundled plugin (validates `dependsOn` works).
- **Random subsets** (50 random per CI run, fixed seed).

This is the only way to actually prove Goal C. Add as `pnpm test:plug-matrix` in the runtime package, run on every PR.

### A.5 Contract tests (run by registry, not by plugin author)

Every plugin gets these tests automatically the moment it's registered:

- Manifest schema valid.
- Every `examples[].tool` resolves to a registered tool.
- Every tool's `schema` is a valid Zod schema.
- Every tool's `description` ≥ 20 chars (LLM-readability floor).
- `whenToUse` ≥ 1 entry (otherwise `find_capability` will never match it).
- If `softDependsOn` includes X, the plugin must have at least one branch on `availablePlugins.has(X)` (static AST check via `tsmorph` or runtime probe).
- If `healthCheck` is set, it must complete within 5s on a sample run.

Make these run at boot in dev mode and in CI. Don't trust authors to remember.

### A.6 Test catalog every bundled plugin must ship

The spec says "write tests using `createTestRuntime`" in §22.11 — not enough. v1 acceptance criteria per bundled plugin:

- [ ] Unit test per tool (happy path + 1 error path).
- [ ] Manifest snapshot test (catches accidental drift).
- [ ] Health-check test (ready and degraded paths).
- [ ] Soft-dep branching test (if applicable) — e.g. tasks-with-memory vs tasks-without-memory.
- [ ] Boot test — plugin loads in isolation.
- [ ] If plugin has BullMQ workers: queue-drain test with mocked Matrix.
- [ ] If plugin has middleware: order-sensitivity test (must run before/after specific other middleware).

Define this as a `pnpm test:plugin <name>` command that runs the whole bundle.

### A.7 Coverage gates

`@ixo/oracle-runtime` should hit:

- Lines/statements: ≥ 85%
- Branches: ≥ 75%
- Plugin-API surface (`plugin-api/`, `bootstrap/`, `registries/`): ≥ 95%

CI fails below threshold. Today the repo has `app.controller.spec.ts` skeletons and minimal coverage tooling — must wire `@vitest/coverage-v8` and add a thresholds block.

---

## Section B — Version-Update DX (the user's #1 ask, deferred in §23.4)

The user's request: *"make the DX easier to update versions with ease."* Spec §23.4 says "Plugins declare `version`, runtime does not enforce. Plugin authors are responsible." That's exactly the surface that hurts on every upgrade. **Promote this to a v1 contract.**

### B.1 Stability tiers for the plugin API

Every export from `@ixo/oracle-runtime` carries a stability tag. Three tiers:

| Tier | Guarantee | Examples | Breakage policy |
|---|---|---|---|
| `stable` | Backwards compatible across all 1.x | `defineOraclePlugin`, `plugin()` builder, core fields of `OraclePlugin` (name, version, manifest, tools, middlewares, configSchema), `RuntimeContext` core fields (user, session, history, config, logger, abortSignal) | Removal/breaking change requires major bump |
| `evolving` | Backwards compatible across minor bumps; may break across minor with 1-version notice | `subAgent()` helper, meta-tool shape, `enrichRequestContext` | Deprecation flag for ≥ 1 minor |
| `experimental` | Anything goes | `intentAwarePrompt` middleware, `find_capability` ranking algorithm, `nestModules` escape hatch | Can break in any release; loud warning when used |

A tagged TypeScript helper makes this enforceable:

```ts
/** @stability stable */
export function defineOraclePlugin<T extends string>(plugin: OraclePlugin<T>): OraclePlugin<T>;

/** @stability experimental — may change in any 1.x release */
export const intentAwarePromptMiddleware = ...;
```

Document tiers in the README and in the `qiforge inspect --stability` output.

### B.2 Runtime-compat declaration

Every plugin declares the runtime range it works with:

```ts
plugin('climate')
  .requiresRuntime('^1.0.0')   // semver range
  // ...
```

At boot:

- Mismatch = warning (not error) for `^` ranges that don't match.
- Missing = warning, "treating as ^current".
- Hard mismatch (e.g. plugin says `^2.0.0` but runtime is `1.x`) = boot error with remediation.

Cheap to add, removes 90% of "why doesn't my plugin work after upgrade" questions.

### B.3 Codemods + migration tool

When a stable surface changes (semver major), ship a codemod with the release:

```
qiforge migrate --from 1.x --to 2.x
```

Built on `ts-morph`. Updates plugin code mechanically (rename of `softDependsOn` → `optionalDependsOn` would be one transform). Without this, "easy version updates" is empty marketing.

### B.4 Deprecation surface

A `deprecate()` helper inside the runtime:

```ts
deprecate({
  api: 'plugin.subAgents',          // removed in spec — but this is the pattern
  since: '1.4.0',
  removeIn: '2.0.0',
  replaceWith: 'use `tools` with `subAgent()` helper',
});
```

Logs a structured warning at boot. Surfaced by `qiforge inspect --deprecated`.

### B.5 Released changelog format

Every minor release of `@ixo/oracle-runtime` ships a structured changelog block:

```md
## 1.4.0
### Stable surface
- (none)
### Evolving surface
- `subAgent({ middleware })` now accepts AgentMiddleware[] (was: single)
### Experimental surface
- `intentAwarePromptMiddleware` ranking changed; review fork tests
### Plugin-author action items
- None.
```

Sets the precedent: a fork operator can read 60 seconds of release notes and know whether their plugins need touching.

### B.6 Testing across runtime versions

For bundled plugins, run tests against the *current* runtime AND the previous minor. Catches regressions before a fork hits them. CI matrix:

```yaml
strategy:
  matrix:
    runtime: [1.3.x, 1.4.x, current]
```

### B.7 Concrete add to §23.4

Replace the current "skip enforcement initially" with:

> Plugins declare `requiresRuntime: '^X.Y.Z'`. Runtime checks on boot.
> Stability tiers are documented per export. Major bumps ship codemods.
> See §B (review doc) for the full version-update contract.

---

## Section C — Plug/Unplug (Goal C) doesn't survive state ownership

Spec §10.3 covers state isolation only for **new** plugin-prefixed fields. The existing graph state has fields that aren't prefixed and aren't owned:

| Existing field (state.ts) | Owner under new world? | Migration step? |
|---|---|---|
| `messages` | core (LangChain reducer) | n/a |
| `config { wsId, did }` | core | rename to `core_config`? |
| `client` | core | move to `RuntimeContext.session.client` |
| `userContext` | memory plugin? portal plugin? | currently used by both |
| `mcpUcanContext` | core (auth)? skills? | shared MCP state |
| `userPreferences` | new userPreferences plugin | freshly added in #189 |
| `browserTools` | portal plugin | yes, prefix as `portal_browserTools` |
| `agActions` | agui plugin | yes, prefix as `agui_agActions` |

### C.1 What v1 must add

Add a §10.6 to the spec naming:

1. **Each existing field's new owner** (table above, finalized).
2. **A migration step**: when checkpoints loaded contain old field names, the registry maps them to new names (or warns and discards). Without this, every fork's existing checkpoints break on first deploy.
3. **The "shared state" pattern**: when two plugins genuinely need to read/write the same state (memory enriches `userContext`, portal reads it), one plugin **owns** it, the other reads via a typed accessor exposed in `RuntimeContext`:

```ts
// memory plugin owns userContext
plugin('memory')
  .state('memory_userContext', userContextAnnotation)
  .exposes({ userContext: (s) => s.memory_userContext });

// portal reads it via ctx (not directly from state)
plugin('portal')
  .softDependsOn('memory')
  .tool('open_portal').handle(async (args, ctx) => {
    const profile = ctx.shared.userContext; // typed if memory loaded, undefined otherwise
  });
```

This is the third lever that's missing today: hard dep, soft dep, and **shared-state accessor**.

### C.2 Validation: `qiforge inspect --state`

Print a table of every state field and its owner. Fork operator runs once after upgrade to spot orphan fields.

---

## Section D — `RuntimeContext` doesn't reach async workers

The spec says (§7.2): *"Built fresh per graph invocation."* That's fine for tool handlers and middleware. But these run outside request context:

- BullMQ processors in `tasksPlugin` (scheduled jobs, recurring jobs)
- Claim-processing worker in `claimProcessingPlugin`
- Health-check loop itself
- Future schedulers, webhooks, retry handlers

In the current code, all of these reach `MatrixManager.getInstance()`, `SecretsService.getInstance()`, etc. The spec's RuntimeContext can't help them — there's no user, no session, no abortSignal tied to a request.

### D.1 Add: `WorkerContext`

Three contexts, not two:

| Context | When | Has user? | Source |
|---|---|---|---|
| `PluginContext` | Boot | No | `buildPluginContext(features, identity, deps)` |
| `RuntimeContext` | Per request | Yes | `buildRuntimeContext(runConfig, ambient)` |
| **`WorkerContext`** | Per job | **Optional** (job carries did/roomId) | `buildWorkerContext(jobMeta, ambient)` |

`WorkerContext` shape:

```ts
interface WorkerContext<TConfig = MergedConfig> {
  job: { id: string; name: string; data: unknown; attemptsMade: number };
  acting?: { did: string; matrixRoomId: string };  // present only if job carries it
  config: TConfig;
  availablePlugins: ReadonlySet<string>;
  secrets: { get: (did: string, keys: string[]) => Promise<...> };
  matrix: { postToRoom; ... };
  llm: { get: (role) => BaseChatModel };
  logger: Logger;
  abortSignal: AbortSignal;  // tied to worker shutdown
}
```

`tasksPlugin` and `claimProcessingPlugin` exclusively use `WorkerContext` in their processors. The framework provides the bridge:

```ts
plugin('tasks')
  .worker({
    queue: 'task-execution',
    handler: async (job, ctx /* WorkerContext */) => { ... },
  })
```

Spec needs §7.5 covering this. Without it, the two most-coupled bundled plugins can't be cleanly migrated and the spec's claim that "every bundled feature becomes a plugin" is false for them.

---

## Section E — `createMainAgent` reduction is aspirational

§14.1 shows ~80 lines of pseudocode. The current 1,052-line file does:

| Concern in current main-agent.ts | Where it goes in spec | Reality check |
|---|---|---|
| 4 MCP client constructors (sandbox, memory, Composio, ucan) | "plugin.setup" | OK — but spec doesn't show the 3rd-party MCP retry/timeout logic |
| 8 sub-agents with `Promise.allSettled` fallbacks | "plugin.tools via `subAgent()`" | Doesn't address the fallback / "skip this sub-agent if init failed" logic |
| UCAN delegation minting (lines 199–236, 336–376) | Implicitly core auth | Not addressed at all in spec; it's a per-request enrichment |
| Conditional sub-agent init (TaskManager iff Redis + roomId + matrixId) | "plugin healthCheck → disabled" | Disable-on-init is different from disable-after-runtime; spec conflates them |
| 11-variable system prompt template | `composePrompt` | OK, mostly mechanical |
| Editor session tracking | editorPlugin | OK |

### E.1 Add: init-failure semantics

Spec needs to cover three init outcomes per plugin, not just two:

1. **Initialized successfully** → `state: ready` (or whatever healthCheck says).
2. **Initialized but degraded** → `state: degraded` from start.
3. **Init threw** → currently spec implies boot error. **Should not.** Forks need: log error, disable plugin, continue boot. Configurable (`features.<plugin>.failureMode: 'fatal' | 'degrade' | 'disable'`, default `'disable'`).

Without this, the current "Promise.allSettled" pattern degrades. Right now if `createPortalAgent` throws, the app keeps booting. Under the new spec it would be a boot error, regressing reliability.

### E.2 The "real" 80-line target

Be honest: aim for ~150 lines in v1, with helper functions for sub-agent fallback, MCP timeouts, prompt composition. Forcing 80 lines invites pushback into "the helpers are still 700 lines" — same monolith, new wrapper.

---

## Section F — Event emitter wiring (`ctx.emit`) is unclaimed

Spec §7.2 promises:

```ts
ctx.emit.toolCall(payload);
ctx.emit.renderComponent(payload);
```

Today (`packages/events/src/graph-event-emitter.ts`) the emitter binds to a Socket.IO server reference at gateway init (`ws/ws.gateway.ts:6`). Plugins don't have access to that reference. Without an explicit wiring path, `ctx.emit` is broken.

### F.1 Add: explicit emit ambient

In `runtime-context/ambient.ts`, the runtime captures the global emitter at boot and routes plugin emissions through it:

```ts
const ambient: AmbientServices = {
  // ...
  emit: createScopedEmitter(rootEventEmitter, runtimeCtx.session),
};
```

The session/wsId comes from RuntimeContext. Confirm in spec that:

- **`emit` is part of RuntimeContext only** (not PluginContext) — emissions need a session.
- **WorkerContext gets a separate emit** with `actingDid`-keyed scope (post-back to user's room, not a live socket).

Document the actual list of events plugins can emit. Today there are 7 event types in `@ixo/events`; spec mentions 4. Pick the full list or a subset, and lock it.

---

## Section G — Boot determinism and observability

A fork operator needs to debug "why isn't plugin X loaded?" without reading framework source. Spec §15.3 has 4 sample errors. Insufficient.

### G.1 Required: `qiforge inspect`

Output schema (JSON + pretty TUI):

```json
{
  "runtime": { "version": "1.4.0", "node": "20.11.0" },
  "plugins": [
    {
      "name": "tasks",
      "version": "1.0.0",
      "source": "bundled",
      "status": "ready",
      "requiresRuntime": "^1.0.0",
      "stability": "stable",
      "dependsOn": [],
      "softDependsOn": ["memory"],
      "softDepsResolved": ["memory"],
      "softDepsMissing": [],
      "tools": [
        { "name": "create_task", "visibility": "always", "schemaHash": "..." },
        ...
      ],
      "middlewares": [{ "name": "auto", "order": 4 }],
      "stateFields": ["tasks_taskRunnerState"],
      "configFields": ["REDIS_URL"],
      "lastHealthCheck": { "at": "...", "state": "ready" }
    }
  ],
  "topo": ["langfuse", "calls", ...],
  "tier1Prompt": "## Available Capabilities\n- ...",
  "tier1TokenEstimate": 1234,
  "collisions": [],
  "warnings": []
}
```

Forks pipe to `jq`. Reviewers paste it into PRs. Worth more than half the prose in §15.

### G.2 Boot manifest persistence

Boot output goes to `<data-dir>/boot-manifest.json` for forensic debug ("plugin X was loaded yesterday but not today"). One-line addition with high payoff.

### G.3 Required: structured boot errors

All boot errors emit a single JSON line at the top of stderr in addition to pretty output, so log aggregators surface them:

```json
{"level":"fatal","event":"boot.plugin.dep_missing","plugin":"claim-processing","missing":"credits","hint":"add features.credits: true"}
```

Pattern is `event: boot.<area>.<reason>`. Document the full event list.

---

## Section H — Smaller but pointed fixes

### H.1 §5 manifest constraints are too tight

`whenToUse` ≤ 8 bullets × 80 chars = 640 chars per plugin. With 15 plugins, that's still 10K chars before examples. The "demote to on-demand" auto-budget in §6.4 will kick in for any realistic deployment, which means **the operator can't predict which plugins are visible**. Tighten:

- Default visibility for all bundled plugins is `'on-demand'` except a curated 4–6.
- `whenToUse` ≤ 4 bullets × 60 chars in Tier-1, full list in Tier-2.

This makes Tier-1 ≤ 800 tokens reliably.

### H.2 §8.1 — soft `subAgents` removal is a regression

Spec removes `subAgents` field (§8.3). Sub-agents are a different *primitive* than tools — they have their own state, prompt, and middleware. Forcing them through `tools` makes:

- Telemetry harder ("which tool is a sub-agent?")
- Sub-agent middleware composition unclear (does it inherit parent middleware?)
- Forking a sub-agent (without exposing it as a tool) impossible

Keep `subAgents` as a distinct field. The "two ways to do it" objection is weak — they're not the same thing.

### H.3 §11.1 healthCheck cadence

30s polling × 15 plugins × 24h = 43,200 calls/day. Many plugins don't need that. Add `healthCheckIntervalMs?: number` per plugin, default 60s, plus a "lazy" mode that runs healthCheck only on agent invocation (cheaper for low-traffic forks).

### H.4 §12 feature toggles — string-typed names are fragile

```ts
features: { slack: true, tasks: true, ... }
```

Spec §12.5 says unknown keys are a boot error. Good. But `features` is `Record<string, boolean | 'auto'>`. Stronger:

```ts
type BundledFeatureName = 'slack' | 'tasks' | 'credits' | 'composio' | ...;
features: Partial<Record<BundledFeatureName, boolean | 'auto'>>;
```

IDE autocompletion. Typos caught at compile time.

### H.5 §16.1 catalog inconsistency

Catalog lists 15 plugins. §22.11 step 11 also lists 15. But ag-ui, calls, claim-processing have inconsistent default behavior (some "ON", some "auto"). Cleanup pass: every plugin's default in catalog matches §16.1's table.

### H.6 Auth as a "plugin" is misleading

Spec §3 non-goal #5 says auth is core. §16.1 doesn't list auth. But §13.1 has `EnricherRegistry` populated by plugins for `enrichRequestContext`. UCAN, DID, and Matrix-OpenID validation are per-request enrichment that plugins might want to hook into (e.g., webhook plugin adds API-key auth). Spec needs a §6.6 covering "what does it mean for a plugin to add auth alongside core auth" — order, fail-fast vs fail-soft, response shape.

### H.7 §19.4 CLI scaffold is one paragraph

Expand: the scaffold should generate a plugin **plus** at minimum:

- `plugin.test.ts` with 3 tests (boot, tool happy path, manifest snapshot).
- A `README.md` stub with the manifest mirrored as docs.
- A `package.json` (if external-plugin scaffold) with `peerDependencies: { @ixo/oracle-runtime: '^1.0.0' }`.

---

## Section I — What v1 acceptance looks like

A merge checklist for PR #190 (this spec) before code starts. Numbered, binary, no "should":

- [ ] Spec §7 adds **WorkerContext** (Section D).
- [ ] Spec §10 adds **state-field migration plan + shared-state accessor** (Section C).
- [ ] Spec §14 acknowledges **init-failure semantics** with `failureMode` config (Section E.1).
- [ ] Spec §19 expands to cover **6 test layers** (Section A.1) and **LLM-determinism** strategy (Section A.3).
- [ ] Spec §22.15 expands to **plug-matrix property tests** (Section A.4).
- [ ] Spec §23.4 replaced with **stability tiers + `requiresRuntime` + codemods + changelog format** (Section B).
- [ ] Spec adds §15.5 **`qiforge inspect` output schema** (Section G).
- [ ] Spec adds §6.6 **plugin auth composition** (Section H.6).
- [ ] Spec adds §7.6 **`ctx.emit` wiring origin** (Section F).
- [ ] Spec adds **stability tag** on every public export in §21.2 (Section B.1).
- [ ] Spec adds explicit **per-bundled-plugin test catalog** (Section A.6).
- [ ] Spec adds **coverage gates** for the runtime package (Section A.7).
- [ ] Spec adds **runtime-version CI matrix** for bundled plugins (Section B.6).

These are additions to the spec doc, not to the code. None should add more than ~200 lines per item to the spec.

---

## Section J — Suggested re-numbering / restructuring

Current spec is 24 sections. After the additions above:

```
Part I — Mental model
  1. Executive summary
  2. Three goals
  3. Non-goals
  4. Three levers

Part II — Plugin authoring
  5. Manifest
  6. Discovery (Tier-1/2/3 + meta-tools + auth composition NEW)
  7. Contexts (PluginContext, RuntimeContext, WorkerContext NEW, ctx.emit wiring NEW)
  8. Plugin API (object form)
  9. SDK (builder form)
  10. Soft deps + state migration NEW

Part III — Runtime mechanics
  11. Health
  12. Feature toggles (typed)
  13. Registries (collision rules + state-owner table NEW)
  14. LangGraph composition (with init-failure semantics NEW)
  15. Boot sequence (with `qiforge inspect` output NEW)

Part IV — Bundled
  16. Catalog
  17. Env vars

Part V — Forks & DX
  18. Starter app
  19. Testing harness (6-layer EXPANDED)
  20. Worked examples
  21. Package layout

Part VI — Versioning & evolution
  22. Stability tiers + version-update contract NEW
  23. Implementation checklist (with plug-matrix property tests EXPANDED)
  24. Open decisions

Part VII — Reference
  25. Glossary
```

This raises versioning to a top-level concern (matches the user's #1 request) and moves testing into the "Forks & DX" part where authors will look first.

---

## Closing

The spec gets **agent DX** right — manifests, three tiers, meta-tools are well thought through. It under-serves **operator DX** (plug/unplug, version updates, observability) and **author confidence** (testing). Goals A and C are at risk without the additions above; Goal B is largely fine.

The single most impactful change: **promote testing and version-update from one-section afterthoughts to first-class parts of the spec.** Everything else follows.
