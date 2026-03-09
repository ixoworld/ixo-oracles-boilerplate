# 01 — Quickstart: Zero to Running Oracle

> **Time:** ~15 minutes
> **What you'll build:** A fully functional AI oracle with blockchain identity, E2E _(End-to-End encrypted — only sender and receiver can read messages)_ communication, and LLM reasoning — responding to messages on the Portal.

---

## Prerequisites

Before starting, make sure you have:

- **Node.js 22+** — check with `node --version`
- **pnpm 10+** — install with `npm install -g pnpm`
- **Docker** _(optional)_ — only needed if you enable the credits system ([install Docker](https://docs.docker.com/get-docker/))
- **IXO Mobile App** — for SignX _(IXO's mobile signing service — your private keys never leave your phone)_ authentication ([iOS](https://apps.apple.com/app/ixo/id1560307060) / [Android](https://play.google.com/store/apps/details?id=com.ixo.mobile))
- **OpenRouter API key** — for LLM access ([get one here](https://openrouter.ai/keys))

---

## Step 1: Install the CLI

```bash
npm install -g qiforge-cli
```

Verify the installation:

```bash
qiforge --help
```

> **Alternative package managers:**
>
> ```bash
> pnpm add -g qiforge-cli
> yarn global add qiforge-cli
> ```

---

## Step 2: Authenticate with SignX

Run the CLI in interactive mode:

```bash
qiforge
```

Select **"Login"** from the menu. A QR code appears in your terminal.

1. Open the **IXO Mobile App** on your phone
2. Scan the QR code
3. Approve the sign-in request

The CLI stores your wallet credentials at `~/.wallet.json`, which includes your blockchain address, DID, and Matrix credentials. The network (devnet/testnet/mainnet) is auto-detected from the Matrix domain.

> **What is SignX?** SignX is IXO's blockchain signing service. Your private keys never leave your phone — the CLI only receives a signed session token.

---

## Step 3: Scaffold Your Project

```bash
qiforge --init
```

The CLI walks you through a series of prompts:

### Project Setup

| Prompt                                                      | Description                                   | Validation                                                         |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| **What is your project named?**                             | Project name or path (e.g., `my-oracle`)      | 1-50 chars, starts with letter, alphanumeric + hyphens/underscores |
| **Select a template to clone**                              | Default: `qiforge`, or enter a custom git URL | Valid git URL                                                      |
| **Create IXO project "my-oracle" in "/path/to/my-oracle"?** | Confirmation                                  | Yes/No                                                             |

### Oracle Identity

After confirming, the CLI launches the **Create Entity** flow:

| Prompt                | Description                                             | Example                             |
| --------------------- | ------------------------------------------------------- | ----------------------------------- |
| **Oracle name**       | Display name for your oracle                            | `Customer Support Bot`              |
| **Price**             | Cost in IXO Credits per interaction ($1 is 1000 credit) | `100`                               |
| **Organization name** | Your organization                                       | `Acme Corp`                         |
| **Profile name**      | Oracle profile display name                             | `Acme Support`                      |
| **Logo URL**          | Public URL to oracle avatar image                       | `https://example.com/logo.png`      |
| **Cover image URL**   | Banner image URL                                        | `https://example.com/cover.png`     |
| **Location**          | Where the oracle operates                               | `Global`                            |
| **Description**       | What the oracle does                                    | `AI-powered customer support agent` |
| **API URL**           | Where the oracle will be hosted                         | `https://my-oracle.example.com`     |
| **Parent protocol**   | _(optional)_ DID of parent protocol entity              | `did:ixo:entity:abc123...`          |

### What happens behind the scenes

When you confirm, the CLI executes a multi-step setup:

1. **Clones the boilerplate** — downloads `qiforge` via git, removes `.git` history, reinitializes a fresh repo
2. **Creates a blockchain entity** — registers an oracle-type entity on the IXO chain with your metadata, pricing, and service configuration
3. **Uploads linked resources** — attaches AuthZ config (permissions), fees config (pricing model), and domain card (verifiable credential) to your entity
4. **Generates a wallet** — creates a secp256k1 wallet and registers a DID on-chain
5. **Registers a Matrix account** — creates a Matrix user with cross-signing enabled, sets display name and avatar
6. **Creates an encrypted Matrix room** — your oracle's home room for checkpoint storage and state management
7. **Generates `.env`** — writes all credentials to `apps/app/.env`

> **Important:** The CLI outputs sensitive credentials (mnemonic, Matrix recovery phrase, access tokens). These are written to your `.env` file automatically, but you should also back them up securely.

---

## Step 4: Configure Your API Keys

The CLI generates a complete `.env` at `apps/app/.env` with all credentials and network config filled in. You only need to add a few API keys.

Open the generated environment file:

```bash
nano my-oracle/apps/app/.env   # nano is a terminal text editor — on Windows, use `notepad` instead
```

**Required:** Add your OpenRouter API key:

```env
OPEN_ROUTER_API_KEY=sk-or-v1-your-key-here
```

### Generated `.env` reference

The CLI auto-fills these variables from the registration process:

> See [CLI Reference](./reference/cli-reference.md) for detailed documentation of all CLI commands and the full env var breakdown.
> See [Environment Variables Reference](./reference/environment-variables.md) for the complete list of all configuration options.

---

## Step 5: Install Dependencies & Build

```bash
cd my-oracle
pnpm install
pnpm build
```

---

## Step 6: Start Your Oracle

```bash
pnpm dev
```

That's it — this starts the NestJS app in watch mode on port 4000.

You should see output like:

```
[Nest] Application is running on: http://localhost:4000
```

What starts up:

- **NestJS server** on port 4000 (or your configured `PORT`)
- **Matrix connection** — initializes cross-signing _(lets your oracle verify its identity across sessions)_ and connects to the Matrix homeserver
- **SQLite checkpoint store** — persistent conversation state via checkpoints _(saved snapshots of conversation state, so the oracle picks up where it left off)_
- **Swagger docs** — available at `http://localhost:4000/docs`

> **Tip:** Visit `http://localhost:4000/docs` to explore the API interactively.

> **Optional: Enable the credits system**
>
> If you want to use the credits/subscription system, you'll need Redis running:
>
> ```bash
> pnpm infra:up    # starts Redis + RedisInsight in Docker
> ```
>
> Then set `DISABLE_CREDITS=false` in your `.env`. Skip this for now — credits are disabled by default and you can enable them later.

---

## Step 7: Test Your Oracle

There are two ways to start your first conversation. Either one works — pick whichever is easiest for you.

### Option A: `qiforge chat` (recommended)

The fastest way to test. Run this from your project directory:

```bash
qiforge chat
```

You'll see an interactive conversation in your terminal:

```
$ qiforge chat

  Connected to MyOracle by MyOrg — An AI assistant for claims processing
  Session: abc123-def456
  Type 'exit' to quit.

MyOracle > Hello, what can you do?

  I can help you with claims processing, verification, and
  blockchain-based credential management. Just tell me what
  you need!

MyOracle > exit

  Session ended. Goodbye!
```

This connects directly to your running oracle — sets up the encrypted chat room and grants permissions automatically.

### Option B: Portal

Open your oracle's portal page:

```
https://dev.portal.qi.space/oracle/{ORACLE_ENTITY_DID}/connect
```

Replace `{ORACLE_ENTITY_DID}` with the value from your `.env` file — it looks like `did:ixo:entity:001acff5f18db27cdf0a21f39747968a`.

1. Click the **Connect** button
2. Open your **IXO Mobile App** and sign the transaction
3. Once connected, you can start chatting right in the portal!

### After the first connection

The first interaction (via CLI or Portal) creates an encrypted chat room between you and your oracle, and grants it permission (via a signed transaction) to act on your behalf. After this one-time setup, you can chat from **any** client:

- **CLI** — `qiforge chat` (easiest for development)
- **Portal** — go to your oracle's contract page and chat in the browser
- **Matrix** — connect with any Matrix client (Element, etc.)

> **Subscription required:** To use the AI Sandbox, skills, and other paid features, you must have an active subscription. See [Payments & Claims](./guides/payments-and-claims.md) for details.

### Option C: curl (for developers)

Send a message directly via the API:

```bash
# First, create a session
curl -X POST http://localhost:4000/sessions \
  -H "Content-Type: application/json" \
  -H "x-did: your-did-here" \
  -H "x-matrix-access-token: your-token-here"
```

Expected response:

```json
{
  "sessionId": "abc123-def456",
  "roomId": "!room:matrix.ixo.world"
}
```

Then send a message using the session ID:

```bash
curl -X POST http://localhost:4000/messages/abc123-def456 \
  -H "Content-Type: application/json" \
  -H "x-did: your-did-here" \
  -H "x-matrix-access-token: your-token-here" \
  -d '{"message": "Hello, what can you do?", "stream": false}'
```

> **Note:** The `x-did` and `x-matrix-access-token` headers are required for authentication. You can find these values in your `~/.wallet.json` file after running `qiforge` login.

---

## What Just Happened — The Message Flow

[View interactive diagram on Excalidraw](https://excalidraw.com/#json=dvmwmdSPSoPvu_GB8PhSt,9ky37UqQ9Hnqjmzf182z-w)

Here's what happens when you send a message:

```
Your message
  → Portal (Client SDK)
  → POST /messages/:sessionId
  → AuthHeaderMiddleware
      validates x-did, x-matrix-access-token
  → SubscriptionMiddleware
      checks credit balance
  → MainAgentGraph.streamMessage()
      → Memory Agent retrieves your context
      → LLM reasoning (OpenRouter)
      → Tool calls (if needed)
      → Safety guardrail checks response
      → Token limiter deducts credits
  → SSE events streamed back to Portal
  → Response stored in Matrix room
```

**Key components:**

- **AuthHeaderMiddleware** — validates your DID and Matrix access token from request headers
- **SubscriptionMiddleware** — checks you have remaining credits (skip with `DISABLE_CREDITS=true`)
- **MainAgentGraph** — the LangGraph state machine that orchestrates your oracle's AI reasoning. It can also use external tools via MCP servers _(external tools your oracle can use — you add them by pasting a URL into a config file. See [Chapter 07](./07-mcp-servers.md).)_
- **Memory Agent** — retrieves your personal context (identity, goals, recent activity) to personalize responses
- **Safety Guardrail** — evaluates responses to prevent credential leaks, PII exposure, and harmful content
- **Token Limiter** — tracks and deducts credits per LLM token usage
- **Matrix Storage** — conversation history is encrypted and stored in your private Matrix room

---

## Troubleshooting

### "Matrix connection failed"

Check that `MATRIX_BASE_URL`, `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN`, and `MATRIX_ORACLE_ADMIN_USER_ID` are correct in your `.env` file. The Matrix homeserver must be reachable from your machine.

### "OPEN_ROUTER_API_KEY is required"

Make sure you've added your OpenRouter API key to `apps/app/.env`. The key should start with `sk-or-v1-`.

### Docker services won't start

Ensure Docker is running: `docker ps`. If ports are in use, check for existing containers: `docker compose ps`.

### Build fails

Run `pnpm install` again from the root directory. If you still see errors, try clearing the build cache:

```bash
pnpm clean  # if available
rm -rf node_modules/.cache
pnpm install
pnpm build
```

---

## Next Steps

You now have a working oracle. Here's where to go from here:

- **[02 — Project Structure](./02-project-structure.md)** — understand what's in your codebase
- **[03 — Customize Your Oracle](./03-customize-your-oracle.md)** — change personality, purpose, and behavior
- **[04 — Working with Skills](./04-working-with-skills.md)** — extend your oracle with skills
- **[Memory Engine Guide](./guides/memory-engine.md)** — give your oracle persistent memory

---

## Network URLs Reference

The CLI auto-selects URLs based on your authenticated network:

| Resource          | Devnet                                          | Testnet                                          | Mainnet                                  |
| ----------------- | ----------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Matrix Homeserver | `https://devmx.ixo.earth`                       | `https://testmx.ixo.earth`                       | `https://mx.ixo.earth`                   |
| Chain RPC         | `https://devnet.ixo.earth/rpc/`                 | `https://testnet.ixo.earth/rpc/`                 | `https://impacthub.ixo.world/rpc/`       |
| Portal            | `https://dev.portal.qi.space`                   | `https://dev.portal.qi.space`                    | `https://portal.qi.space`                |
| Domain Indexer    | `https://domain-indexer.devnet.ixo.earth/index` | `https://domain-indexer.testnet.ixo.earth/index` | `https://domain-indexer.ixo.earth/index` |
