# 01 — Quickstart: Zero to Running Oracle

> **Time:** ~15 minutes
> **What you'll build:** A fully functional AI oracle with blockchain identity, E2E encrypted communication, and LLM reasoning — responding to messages on the IXO Portal.

---

## Prerequisites

Before starting, make sure you have:

- **Node.js 22+** — check with `node --version`
- **pnpm 10+** — install with `npm install -g pnpm`
- **Docker** — for Redis and Nginx ([install Docker](https://docs.docker.com/get-docker/))
- **IXO Mobile App** — for SignX authentication ([iOS](https://apps.apple.com/app/ixo/id1560307060) / [Android](https://play.google.com/store/apps/details?id=com.ixo.mobile))
- **OpenRouter API key** — for LLM access ([get one here](https://openrouter.ai/keys))

---

## Step 1: Install the CLI

```bash
npm install -g ixo-oracles-cli
```

Verify the installation:

```bash
oracles-cli --help
```

> **Alternative package managers:**
>
> ```bash
> pnpm add -g ixo-oracles-cli
> yarn global add ixo-oracles-cli
> ```

---

## Step 2: Authenticate with SignX

Run the CLI in interactive mode:

```bash
oracles-cli
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
oracles-cli --init
```

The CLI walks you through a series of prompts:

### Project Setup

| Prompt                                                      | Description                                                   | Validation                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| **What is your project named?**                             | Project name or path (e.g., `my-oracle`)                      | 1-50 chars, starts with letter, alphanumeric + hyphens/underscores |
| **Select a template to clone**                              | Default: `ixo-oracles-boilerplate`, or enter a custom git URL | Valid git URL                                                      |
| **Create IXO project "my-oracle" in "/path/to/my-oracle"?** | Confirmation                                                  | Yes/No                                                             |

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

1. **Clones the boilerplate** — downloads `ixo-oracles-boilerplate` via git, removes `.git` history, reinitializes a fresh repo
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
nano my-oracle/apps/app/.env
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

## Step 6: Start Infrastructure

```bash
cd apps/app
pnpm infra:up
pnpm dev
```

This starts the Docker services your oracle needs:

| Service      | Port | Purpose                  |
| ------------ | ---- | ------------------------ |
| Redis        | 6379 | Session storage, caching |
| RedisInsight | 8001 | Redis management UI      |

---

## Step 7: Start the Oracle

```bash
pnpm start:dev
```

You should see output like:

```
[Nest] Application is running on: http://localhost:4000
```

What starts up:

- **NestJS server** on port 4000 (or your configured `PORT`)
- **Matrix connection** — initializes cross-signing and connects to the Matrix homeserver
- **SQLite checkpoint store** — persistent conversation state
- **Swagger docs** — available at `http://localhost:4000/docs`

> **Tip:** Visit `http://localhost:4000/docs` to explore the API interactively.

---

## Step 8: Test on the Portal

1. Open **[https://ixo-portal.vercel.app](https://ixo-portal.vercel.app)**
2. Navigate to your oracle (search by name or entity DID)
3. Connect your wallet (same IXO Mobile App used in Step 2)
4. Send a message

The first portal interaction is special — it:

- Creates a private encrypted Matrix room between you and the oracle
- Grants AuthZ permissions for the oracle to act on your behalf
- Establishes your subscription

After this initial setup, you can also connect via Matrix clients or Slack.

---

## What Just Happened — The Message Flow

[View interactive diagram on Excalidraw](https://excalidraw.com/#json=dvmwmdSPSoPvu_GB8PhSt,9ky37UqQ9Hnqjmzf182z-w)

Here's what happens when you send a message:

```
Your message
  → IXO Portal (Client SDK)
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
- **MainAgentGraph** — the LangGraph state machine that orchestrates your oracle's AI reasoning
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
| Portal            | `https://ixo-portal.vercel.app`                 | `https://ixo-portal.vercel.app`                  | `https://ixo-portal.vercel.app`          |
| Domain Indexer    | `https://domain-indexer.devnet.ixo.earth/index` | `https://domain-indexer.testnet.ixo.earth/index` | `https://domain-indexer.ixo.earth/index` |
