# Oracle Builder Spec — "Stupidly Easy Oracle Creation"

## Architecture Overview

```
User (Portal) → Builder Oracle (Agent 1) → AI Sandbox + Claude Code (Agent 2) → Fly.io
```

- **Builder Oracle**: A qiforge oracle running in Portal. Its job is to help users create other oracles. User chats with it via normal Portal chat (SignX login).
- **AI Sandbox**: The existing sandbox (SANDBOX_MCP_URL). Claude Code runs inside it to edit code, build, and test.
- **Fly.io**: Production runtime for deployed oracles.

---

## State Machine

The Builder Oracle tracks creation progress via LangGraph state. Each field has a completion flag.

### OracleBuilderState (LangGraph Annotation)

```typescript
const OracleBuilderState = Annotation.Root({
  // Standard message history
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Current step in the creation flow
  currentStep: Annotation<OracleCreationStep>({
    default: () => 'intake',
    reducer: (_, curr) => curr,
  }),

  // The oracle spec being built (accumulated across conversation)
  spec: Annotation<OracleSpec>({
    default: () => emptySpec(),
    reducer: (prev, curr) => ({ ...prev, ...curr }),
  }),

  // Step completion tracking
  completedSteps: Annotation<Record<OracleCreationStep, boolean>>({
    default: () => ({
      intake: false,
      identity: false,
      personality: false,
      capabilities: false,
      model: false,
      review: false,
      build: false,
      test: false,
      deploy: false,
    }),
    reducer: (prev, curr) => ({ ...prev, ...curr }),
  }),

  // Sandbox state
  sandbox: Annotation<SandboxState>({
    default: () => ({ id: null, url: null, status: 'idle' }),
    reducer: (_, curr) => curr,
  }),

  // Deployment state
  deployment: Annotation<DeploymentState>({
    default: () => ({ flyAppId: null, url: null, entityDid: null, status: 'pending' }),
    reducer: (_, curr) => curr,
  }),

  // User DID (from SignX login)
  userDid: Annotation<string>({
    default: () => '',
    reducer: (_, curr) => curr,
  }),
});
```

### OracleSpec (the contract between Agent 1 and Agent 2)

```typescript
interface OracleSpec {
  // === Identity (Step: intake + identity) ===
  oracleName: string | null;         // "CarbonAdvisor"
  orgName: string | null;            // "IXO Earth"
  description: string | null;        // "Carbon credit verification advisor"
  location: string | null;           // "Global"
  logo: string | null;               // URL or null for default
  price: number | null;              // IXO credits per interaction

  // === Personality (Step: personality) ===
  promptOpening: string | null;      // "You are a carbon markets specialist..."
  communicationStyle: string | null; // "Professional but approachable"
  capabilities: string | null;       // "Help with carbon credit methodologies..."
  customInstructions: string | null; // Any extra user instructions

  // === Capabilities (Step: capabilities) ===
  skills: string[];                  // ["pdf", "docx", "xlsx"]
  mcpServers: MCPServerConfig[];     // [{name, url, description, tested}]
  customTools: string | null;        // Markdown describing custom tool needs

  // === Model (Step: model) ===
  model: string;                     // "moonshotai/kimi-k2.5" (default)
  modelReasoning: string | null;     // Why this model was chosen

  // === Network ===
  network: 'devnet' | 'testnet' | 'mainnet';
}

interface MCPServerConfig {
  name: string;
  url: string;
  description: string;
  tested: boolean;  // Did the MCP tester verify it works?
}
```

---

## Creation Steps (State Machine Flow)

```
intake → identity → personality → capabilities → model → review → build → test → deploy
```

Each step has: **entry condition**, **what happens**, **tools used**, **exit condition**.

---

### Step 1: `intake`

**What happens**: User describes what they want in free text. Agent extracts initial requirements.

**Agent behavior**:
- Greet user: "What kind of oracle do you want to create? Just describe it in your own words."
- User types: "I want an oracle that helps farmers track their crops and get weather data"
- Agent extracts: name suggestion, description, initial skill/MCP ideas
- Agent summarizes back: "So you want an oracle called FarmHelper that..."

**Tools**: None (pure conversation)

**Exit condition**: `spec.description` is not null AND user confirmed the summary.

**State update**:
```
spec.oracleName = "FarmHelper" (suggested)
spec.description = "Helps farmers track crops and get weather data"
completedSteps.intake = true
currentStep = 'identity'
```

---

### Step 2: `identity`

**What happens**: Agent asks for oracle identity details.

**Agent behavior**:
- "Great! Let's set up your oracle's identity."
- Asks for: name (confirm or change), org name, location, logo
- For each: suggest a default, let user accept or change
- "Your oracle will be called **FarmHelper** by **[your org]**. Sound good?"

**Tools**:
- `update_spec` — updates spec fields (renders as live spec preview in Portal)

**Exit condition**: `spec.oracleName` + `spec.orgName` are set. User confirmed.

**State update**:
```
spec.oracleName = "FarmHelper"
spec.orgName = "Green Valley Co-op"
spec.location = "East Africa"
spec.logo = null (default)
spec.price = 50 (suggested based on complexity)
completedSteps.identity = true
currentStep = 'personality'
```

---

### Step 3: `personality`

**What happens**: Agent designs the oracle's personality and system prompt.

**Agent behavior**:
- "Now let's give your oracle a personality. How should it talk to your users?"
- Suggests tone options: "friendly and simple", "professional", "technical expert"
- Generates `promptOpening` based on description + tone
- Shows the user: "Here's how your oracle will introduce itself: ..."
- Asks: "Want to change anything about how it communicates?"

**Tools**:
- `update_spec` — writes prompt fields
- `generate_prompt` — calls Claude/Kimi to generate prompt opening from description + style

**Exit condition**: `spec.promptOpening` + `spec.communicationStyle` + `spec.capabilities` are set.

**State update**:
```
spec.promptOpening = "You are a friendly agricultural assistant powered by {{APP_NAME}}..."
spec.communicationStyle = "Use simple language. Avoid jargon..."
spec.capabilities = "Track crop planting schedules, provide weather forecasts..."
completedSteps.personality = true
currentStep = 'capabilities'
```

---

### Step 4: `capabilities`

**What happens**: Agent configures skills and MCP servers.

**Agent behavior**:
- "Let's set up what your oracle can do."
- **Skills**: Searches ai-skills registry, suggests relevant skills
  - "I found these skills that match your oracle: PDF reports, Data charts, Weather data. Want to add any?"
  - Shows checklist (tool call renders as UI component)
  - User toggles on/off
- **MCPs**: Asks about capabilities conversationally
  - "Should your oracle be able to search the web?" → adds firecrawl
  - "Should it remember past conversations?" → adds memory engine
  - "Do you have any custom data sources? (paste an MCP URL)" → tests with `test_mcp_server`
- **Custom tools**: "Anything else your oracle should be able to do that we haven't covered?"
  - If yes, captures as markdown description for Claude Code to implement

**Tools**:
- `search_skills` — search ai-skills registry
- `update_spec` — add/remove skills
- `test_mcp_server` — sub-agent that connects to an MCP URL, lists tools, reports back
- `update_spec` — add MCP servers

**Exit condition**: `spec.skills.length >= 0` (can be empty) AND user confirmed capabilities.

**State update**:
```
spec.skills = ["pdf", "xlsx"]
spec.mcpServers = [
  { name: "weather-api", url: "https://weather-mcp.example.com", description: "Weather data", tested: true }
]
spec.customTools = "A tool that queries the local agricultural database for crop prices"
completedSteps.capabilities = true
currentStep = 'model'
```

---

### Step 5: `model`

**What happens**: Agent helps pick the AI model.

**Agent behavior**:
- "Last config step — which AI brain should power your oracle?"
- Shows ~5 options from OpenRouter with simple descriptions:
  - **Kimi K2.5** (default) — "Fast, smart, great for most oracles"
  - **Claude Sonnet 4** — "Excellent reasoning, great for complex tasks"
  - **GPT-4o** — "Fast and reliable, good general purpose"
  - **Gemini 2.5 Pro** — "Great with large documents and data"
  - **Llama 4 Maverick** — "Cost-effective, open source"
- Agent recommends based on oracle's purpose
- "For a farming oracle that needs weather data and simple reports, I'd recommend **Kimi K2.5** — it's fast and handles tool calls well."

**Tools**:
- `update_spec` — sets model

**Exit condition**: `spec.model` is set.

**State update**:
```
spec.model = "moonshotai/kimi-k2.5"
spec.modelReasoning = "Good balance of speed and tool-calling for agricultural assistant"
completedSteps.model = true
currentStep = 'review'
```

---

### Step 6: `review`

**What happens**: Agent shows complete spec, user reviews and confirms.

**Agent behavior**:
- "Here's the complete spec for your oracle:"
- Shows full spec as a formatted card/component:
  ```
  Name: FarmHelper
  Org: Green Valley Co-op
  Description: Helps farmers track crops and get weather data
  Personality: Friendly, simple language
  Skills: PDF reports, Data charts
  MCPs: Weather API, Memory Engine
  Custom tools: Crop price database query
  Model: Kimi K2.5
  Network: devnet
  ```
- "Want to change anything? Or should I start building?"
- User can go back to any step or say "build it"

**Tools**:
- `show_spec_review` — renders full spec as UI component
- `update_spec` — if user wants changes

**Exit condition**: User explicitly says to proceed with building.

**State update**:
```
completedSteps.review = true
currentStep = 'build'
```

---

### Step 7: `build`

**What happens**: Agent 1 invokes Claude Code in the AI Sandbox to build the oracle.

**Agent behavior**:
- "Building your oracle now... This takes a couple of minutes."
- Shows progress component

**What happens in the sandbox**:
1. Clone qiforge boilerplate repo
2. Claude Code reads the spec (JSON + markdown)
3. Claude Code reads the qiforge codebase docs (CLAUDE.md, playbook)
4. Claude Code edits files:
   - Writes `oracle.config.json` with identity + prompt + model + skills
   - If `customTools` specified: adds custom tools to `main-agent.ts`
   - If custom MCPs: adds MCP server configs to `mcp.ts`
   - Runs `pnpm install`
   - Runs `pnpm build`
   - Runs `pnpm test` (if tests exist)
5. Reports build status back

**Tools**:
- `sandbox_build_oracle` — orchestrates the full build in sandbox:
  1. Calls `sandbox_run` to clone repo
  2. Calls `sandbox_write` to write the spec file
  3. Calls `sandbox_run` to invoke Claude Code with the spec
  4. Calls `sandbox_run` to build (`pnpm install && pnpm build`)
  5. Returns build status (success/failure + logs)

**Exit condition**: Build succeeds (pnpm build exits 0).

**Error handling**: If build fails, agent shows error to user, asks Claude Code to fix it, retries up to 3 times. If still failing, asks user for help or adjusts spec.

**State update**:
```
sandbox.id = "sandbox-abc123"
sandbox.status = 'built'
completedSteps.build = true
currentStep = 'test'
```

---

### Step 8: `test`

**What happens**: Sandbox oracle is started, entity is updated to point to sandbox URL, user tests in Portal.

**Agent behavior**:
1. "Build successful! Starting your oracle for testing..."
2. Starts oracle in sandbox (`pnpm dev` or `node dist/main`)
3. Exposes sandbox URL (e.g., `https://sandbox-abc123.sandbox.ixo.earth`)
4. Registers blockchain entity (wallet, DID, Matrix account, entity)
5. Updates entity API URL to sandbox URL
6. "Your oracle is live for testing! Open this link to try it:"
   - Shows portal link: `https://portal.qi.space/oracle/{entity-did}/connect`
7. "Chat with your oracle and come back to me when you're done testing."
8. User tests in Portal (separate chat with their new oracle)
9. User comes back: "Looks good!" or "Change X"

**Tools**:
- `sandbox_start_oracle` — starts the oracle process in sandbox, returns URL
- `register_oracle_entity` — creates wallet, DID, Matrix account, entity on-chain
- `update_entity_api_url` — updates entity's API URL to sandbox URL (uses qiforge CLI)
- `show_test_link` — renders portal link as clickable card in chat

**If user wants changes**:
- Go back to the relevant step (personality, capabilities, etc.)
- Re-run build with updated spec
- Re-test

**Exit condition**: User explicitly confirms testing is done and oracle works.

**State update**:
```
sandbox.url = "https://sandbox-abc123.sandbox.ixo.earth"
sandbox.status = 'testing'
deployment.entityDid = "did:ixo:entity:abc123..."
completedSteps.test = true
currentStep = 'deploy'
```

---

### Step 9: `deploy`

**What happens**: Build Docker image, push to registry, deploy to Fly.io, update entity URL.

**Agent behavior**:
1. "Deploying your oracle to production..."
2. Shows progress:
   - [ ] Building Docker image...
   - [ ] Pushing to registry...
   - [ ] Creating Fly.io app...
   - [ ] Setting secrets...
   - [ ] Starting machine...
   - [ ] Updating entity URL...
   - [ ] Verifying health...
3. "Your oracle is LIVE!"
   - URL: `https://farmhelper.fly.dev`
   - Portal: `https://portal.qi.space/oracle/{entity-did}/connect`

**What happens technically**:
1. `docker build` inside sandbox → push to GHCR (`ghcr.io/ixoworld/oracle-farmhelper:latest`)
2. Create Fly.io app via Machines API (`farmhelper` in IXO org)
3. Create 1GB volume at `/data`
4. Set all secrets (per-oracle + IXO infra constants)
5. Create machine with base image, volume mount, env vars
6. Wait for health check (`GET /` returns 200)
7. Update entity API URL on-chain from sandbox URL → Fly.io URL
8. Tear down sandbox

**Tools**:
- `sandbox_docker_build` — builds + pushes Docker image from sandbox
- `fly_create_app` — creates Fly.io app via Machines API
- `fly_create_volume` — creates persistent volume
- `fly_set_secrets` — sets env vars
- `fly_create_machine` — starts the machine
- `fly_health_check` — polls until healthy
- `update_entity_api_url` — updates on-chain API URL to Fly.io URL
- `sandbox_teardown` — cleans up sandbox

**Exit condition**: Health check passes AND entity URL updated.

**State update**:
```
deployment.flyAppId = "farmhelper"
deployment.url = "https://farmhelper.fly.dev"
deployment.status = 'live'
sandbox.status = 'torn_down'
completedSteps.deploy = true
currentStep = 'done' // terminal state
```

---

## Tools Summary

### Conversation Tools (Agent 1 — Builder Oracle)

| Tool | Purpose | UI Component |
|------|---------|-------------|
| `update_spec` | Update any spec field | Live spec preview card |
| `generate_prompt` | Generate prompt from description + style | Shows generated text |
| `search_skills` | Search ai-skills registry | Skill checklist |
| `test_mcp_server` | Connect to MCP URL, verify it works | Pass/fail indicator |
| `show_spec_review` | Show complete spec for review | Full spec card |
| `show_progress` | Show step completion status | Progress tracker |

### Build Tools (Agent 1 calls into Sandbox)

| Tool | Purpose |
|------|---------|
| `sandbox_build_oracle` | Clone repo + write spec + Claude Code edits + pnpm build |
| `sandbox_start_oracle` | Start oracle in sandbox, expose URL |
| `sandbox_docker_build` | Build Docker image + push to GHCR |
| `sandbox_teardown` | Clean up sandbox |

### Blockchain Tools (Agent 1)

| Tool | Purpose |
|------|---------|
| `register_oracle_entity` | Create wallet, DID, Matrix account, entity |
| `update_entity_api_url` | Update entity API URL on-chain |

### Deployment Tools (Agent 1)

| Tool | Purpose |
|------|---------|
| `fly_create_app` | Create Fly.io app via Machines API |
| `fly_create_volume` | Create 1GB persistent volume |
| `fly_set_secrets` | Set all env vars as Fly secrets |
| `fly_create_machine` | Create + start the machine |
| `fly_health_check` | Poll health endpoint |

---

## The Builder Oracle Itself

The Builder Oracle is a qiforge oracle with:

- **System prompt**: Specialized for oracle creation. Knows the steps, knows how to gather requirements, knows the spec format.
- **State**: `OracleBuilderState` (defined above) instead of `MainAgentGraphState`
- **Tools**: The tools listed above instead of the standard oracle tools
- **Model**: Kimi K2.5 (default) or Claude for the conversation agent
- **Entry point**: Portal chat — user connects to the Builder Oracle entity via SignX

It runs on IXO's infrastructure as a permanent oracle. Its entity DID is registered on-chain like any other oracle. Users find it on Portal and chat with it to create their own oracles.

---

## Spec File Format (JSON + Markdown Hybrid)

What Agent 1 writes for Agent 2 to read:

```
/workspace/oracle-spec/spec.json     — structured config fields
/workspace/oracle-spec/README.md     — custom instructions, personality description,
                                       custom tool descriptions in natural language
```

**spec.json**:
```json
{
  "oracleName": "FarmHelper",
  "orgName": "Green Valley Co-op",
  "description": "Helps farmers track crops and get weather data",
  "location": "East Africa",
  "logo": null,
  "price": 50,
  "network": "devnet",
  "prompt": {
    "opening": "You are a friendly agricultural assistant powered by {{APP_NAME}}...",
    "communicationStyle": "Use simple language. Avoid jargon. Explain farming terms.",
    "capabilities": "Track crop planting schedules, provide weather forecasts, generate PDF reports."
  },
  "model": "moonshotai/kimi-k2.5",
  "skills": ["pdf", "xlsx"],
  "mcpServers": [
    { "name": "weather-api", "url": "https://weather-mcp.example.com" }
  ]
}
```

**README.md**:
```markdown
# FarmHelper Oracle — Build Spec

## Custom Tools Needed

### Crop Price Lookup
The oracle needs a tool that queries the local agricultural database
for current crop prices. The API endpoint is:
- GET https://agri-db.example.com/prices?crop={name}&region={region}
- Returns: { crop, price_per_kg, currency, last_updated }

The tool should be called `lookup_crop_price` and accept crop name
and region as parameters.

## Special Instructions
- Always greet farmers by name if known from memory
- When giving weather data, always include a farming recommendation
- Generate weekly PDF reports of crop status if the user asks
```

---

## Phase 1 Code Changes (This PR)

To make the above possible, we need config-driven oracle customization first.

### 1. Extend `oracle.config.json`

**File**: `apps/app/oracle.config.json`

Add `prompt`, `model`, `skills`, `mcpServers` fields to the existing config.

### 2. Update `prompt.ts` to read from config

**File**: `apps/app/src/graph/nodes/chat-node/prompt.ts`

Add `{{CUSTOM_OPENING}}`, `{{CUSTOM_COMMUNICATION_STYLE}}`, `{{CUSTOM_CAPABILITIES}}` template variables. When set (from oracle.config.json), they override the default prompt sections.

### 3. Wire `main-agent.ts` to use config

**File**: `apps/app/src/graph/agents/main-agent.ts`

- Read `prompt` fields from `oracleConfig` → inject into prompt template
- Read `model` from config → pass to `getProviderChatModel()`
- Read `skills` from config (for future use)
- Support `ORACLE_CONFIG_PATH` env var for runtime config path

### 4. Update `config.ts`

**File**: `apps/app/src/config.ts`

Add: `ORACLE_CONFIG_PATH` (optional string)

### 5. Add Fly.io deployment scripts

**File**: `scripts/fly-build-base.sh` — Build base image + push to GHCR
**File**: `scripts/fly-deploy-oracle.sh` — Create Fly app + volume + secrets + machine via Machines API

---

## Verification

1. Edit `oracle.config.json` → add prompt/model fields → `pnpm build` passes
2. Start oracle → verify it uses the config-driven prompt and model
3. `pnpm lint && pnpm format:check` pass
4. `docker build -t test:latest --build-arg PROJECT=app .` succeeds
5. `scripts/fly-deploy-oracle.sh` creates a Fly app from the base image
