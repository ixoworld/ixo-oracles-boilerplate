# Reference: CLI Commands

> Complete reference for `qiforge-cli` (v1.1.0) — the CLI tool for creating and managing QiForge Oracle projects.

---

## Installation

```bash
npm install -g qiforge-cli
```

Binary name: `qiforge`

Verify:

```bash
qiforge --help
```

---

## Usage

```bash
qiforge              # Interactive menu
qiforge --init       # Jump straight to project scaffolding
qiforge --help       # Show help
qiforge -h           # Show help (short form)
```

When run without flags, the CLI shows an interactive menu with all available commands.

---

## Wallet Requirement

Most commands require an authenticated wallet. The CLI stores wallet credentials at `~/.wallet.json` after a successful SignX login. The wallet file contains:

- Blockchain address and DID
- Public key and algorithm
- Matrix credentials (user ID, access token, password, recovery phrase)
- Network selection (devnet/testnet/mainnet)

If no wallet is found, the CLI prompts you to log in first via SignX.

---

## Commands

### `signx-login` — Authenticate with SignX

Authenticates via QR code using the IXO Mobile App.

**Flow:**

1. CLI connects to the SignX relay server for your network
2. A QR code appears in the terminal
3. Open the **IXO Mobile App** and scan the QR code
4. Approve the sign-in request on your phone
5. The CLI receives a signed session token (private keys never leave the phone)

**What gets stored** (`~/.wallet.json`):

```json
{
  "address": "ixo1abc...",
  "algo": "secp256k1",
  "did": "did:ixo:ixo1abc...",
  "network": "testnet",
  "matrix": {
    "userId": "@did-ixo-ixo1abc:testmx.ixo.earth",
    "accessToken": "syt_...",
    "password": "...",
    "recoveryPhrase": "...",
    "deviceName": "...",
    "roomId": "!abc:testmx.ixo.earth"
  },
  "pubKey": "A...",
  "ledger": false
}
```

**Network auto-detection:** The network (devnet/testnet/mainnet) is embedded in the SignX session — no manual selection needed.

**SignX relay endpoints:**

| Network | URL                               |
| ------- | --------------------------------- |
| Devnet  | `https://signx.devnet.ixo.earth`  |
| Testnet | `https://signx.testnet.ixo.earth` |
| Mainnet | `https://signx.ixo.earth`         |

---

### `init` — Scaffold a New Oracle Project

Full project scaffolding: clones the boilerplate, creates a blockchain entity, registers a Matrix account, and generates `.env`.

```bash
qiforge --init
```

**Prompts:**

| #   | Prompt                          | Validation                                               | Default                                               |
| --- | ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **What is your project named?** | 1–50 chars, starts with letter, `[a-zA-Z][a-zA-Z0-9-_]*` | —                                                     |
| 2   | **Select a template to clone**  | Valid git URL                                            | `git@github.com:ixoworld/qiforge.git` |
| 3   | **Confirm creation**            | Yes / No                                                 | —                                                     |

After confirmation, the CLI runs the **Create Entity** flow (see below), then generates the `.env` file.

**Steps executed:**

1. Clone repository template
2. Remove `.git` and reinitialize fresh git repo
3. Run `create-entity` (creates wallet, DID, Matrix account, blockchain entity)
4. Generate `apps/app/.env` with all credentials and config
5. Store project config (name, path, repo) in runtime

**Generated `.env` file** (`apps/app/.env`):

The CLI generates a complete `.env` with all variables needed to run the oracle. See [Generated Environment Variables](#generated-environment-variables) for the full template.

---

### `create-entity` — Create an Oracle Entity

Creates a new oracle identity: wallet, DID, Matrix account, and blockchain entity registration. This command runs automatically during `init`, but can also be run standalone.

**Prompts:**

| #   | Prompt                    | Validation                                                 | Default                 |
| --- | ------------------------- | ---------------------------------------------------------- | ----------------------- |
| 1   | **Matrix homeserver URL** | Must start with `http://` or `https://`, no trailing slash | Derived from wallet     |
| 2   | **Oracle name**           | Non-empty string                                           | `My oracle`             |
| 3   | **Oracle price**          | Number (IXO CREDITS)                                       | `100`                   |
| 4   | **Organization name**     | Non-empty string                                           | `IXO`                   |
| 5   | **Profile name**          | Non-empty string                                           | `My oracle`             |
| 6   | **Logo URL**              | Valid URL                                                  | DiceBear avatar URL     |
| 7   | **Cover image URL**       | Valid URL                                                  | Same as logo            |
| 8   | **Location**              | Non-empty string                                           | `New York, NY`          |
| 9   | **Description**           | Non-empty string                                           | Generic description     |
| 10  | **Website URL**           | URL (optional)                                             | —                       |
| 11  | **API URL**               | Valid URL                                                  | `http://localhost:4000` |

**What happens behind the scenes:**

1. **Generate oracle wallet** — creates a BIP39 24-word mnemonic, derives a secp256k1 keypair and blockchain address
2. **Fund oracle wallet** — transfers 250,000 uixo (0.25 IXO) from your authenticated wallet to the new oracle
3. **Create DID document** — registers an IID (Interchain Identifier Document) on-chain with a Matrix service endpoint
4. **Create Matrix account** — registers via secp256k1 signature authentication:
   - Derives Matrix password from mnemonic (MD5 hash, first 24 bytes, base64)
   - Derives passphrase from mnemonic (SHA256 hash, first 32 bytes, base64)
   - Encrypts password with ECIES using the room bot's public key
   - Registers via room bot `/user/create` endpoint
5. **Set up cross-signing** — bootstraps Matrix secret storage and cross-signing keys
6. **Create Matrix room** — creates/joins a room with alias `#did-ixo-<address>:<homeserver>`
7. **Encrypt vault** — encrypts the Matrix mnemonic with AES-256-CBC using the 6-digit PIN, stores in room state event `ixo.room.state.secure/encrypted_mnemonic`
8. **Upload profile** — uploads oracle metadata (name, logo, cover, location, description) to Matrix
9. **Broadcast `MsgCreateEntity`** — creates the blockchain entity with:
   - Profile linked resource
   - API service and WebSocket service endpoints
   - Parent protocol: `did:ixo:entity:1a76366f16570483cea72b111b27fd78` (QiForge Oracle Protocol)
   - Linked accounts: Memory Engine + oracle account
   - Requires **mobile signing** via QR code (SignX)
10. **Upload domain card** — creates a W3C verifiable credential, uploads to Matrix, attaches to entity via `MsgAddLinkedResource`
11. **Upload configs** — attaches AuthZ config (required blockchain permissions) and fees config (pricing in IXO CREDITS, converted to uixo at 1 credit = 1000 uixo) to entity

**Output:**

- Entity DID (printed to terminal)
- Oracle portal URL: `https://ixo-portal.vercel.app/oracle/<entityDid>/overview`

---

### `create-user` — Create a New User/Oracle Account

Creates a new blockchain wallet, DID, and Matrix account without creating an entity. Useful for creating test users or additional oracle accounts.

**Prompts:**

| #   | Prompt                    | Validation                              | Default             |
| --- | ------------------------- | --------------------------------------- | ------------------- |
| 1   | **Matrix homeserver URL** | Must start with `http://` or `https://` | Derived from wallet |
| 2   | **6-digit PIN**           | Exactly 6 digits                        | —                   |
| 3   | **Oracle name**           | Non-empty string                        | —                   |

**What gets created:**

- BIP39 mnemonic wallet
- On-chain DID document
- Matrix account with cross-signing
- Matrix room with encrypted vault
- Funded with 150,000 uixo (0.15 IXO) from your wallet

**Output:** Full registration result including address, DID, mnemonic, Matrix credentials, and room ID.

---

### `update-entity` — Update an Existing Entity

Modifies an existing blockchain entity. Currently supports adding controllers.

**Prompts:**

| #   | Prompt             | Validation                              | Default |
| --- | ------------------ | --------------------------------------- | ------- |
| 1   | **Entity DID**     | Format: `did:ixo:entity:<32-hex-chars>` | —       |
| 2   | **Action**         | Currently only: `add-controller`        | —       |
| 3   | **Controller DID** | Valid DID string                        | —       |

Broadcasts `MsgAddController` to add a new controller DID to the entity. Requires mobile signing via SignX QR code.

---

### `logout` — Clear Local Wallet

```bash
qiforge logout
```

Clears `~/.wallet.json`. You will need to log in again via SignX to use other commands.

---

### `help` — Show Available Commands

```bash
qiforge --help
qiforge -h
```

Displays all available commands with descriptions.

---

## Generated Environment Variables

The CLI generates a complete `.env` file at `apps/app/.env`. Here's what each section contains:

### Auto-filled (from registration and network)

| Variable                           | Source                           | Description                        |
| ---------------------------------- | -------------------------------- | ---------------------------------- |
| `PORT`                             | Default `4000`                   | Server port                        |
| `ORACLE_NAME`                      | Project name prompt              | Oracle display name                |
| `NETWORK`                          | SignX login                      | `devnet`, `testnet`, or `mainnet`  |
| `RPC_URL`                          | Derived from network             | Blockchain RPC endpoint            |
| `MATRIX_BASE_URL`                  | Entity creation prompt           | Matrix homeserver URL              |
| `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN` | Fresh Matrix login               | Oracle admin access token          |
| `MATRIX_ORACLE_ADMIN_PASSWORD`     | Derived from mnemonic            | Oracle Matrix password             |
| `MATRIX_ORACLE_ADMIN_USER_ID`      | Matrix registration              | Oracle Matrix user ID              |
| `MATRIX_RECOVERY_PHRASE`           | Cross-signing setup              | Recovery phrase for secret storage |
| `MATRIX_VALUE_PIN`                 | Entity creation prompt           | 6-digit PIN for encrypted vault    |
| `MATRIX_ACCOUNT_ROOM_ID`           | Matrix room creation             | Oracle's Matrix account room       |
| `SECP_MNEMONIC`                    | Wallet generation                | 24-word BIP39 mnemonic             |
| `ORACLE_ENTITY_DID`                | Entity broadcast                 | Blockchain entity DID              |
| `SQLITE_DATABASE_PATH`             | Default `./sqlite-db`            | SQLite checkpoint database path    |
| `REDIS_URL`                        | Default `redis://localhost:6379` | Redis connection URL               |
| `DOMAIN_INDEXER_URL`               | Derived from network             | Domain Indexer API endpoint        |

### Must be filled manually

| Variable              | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `OPEN_ROUTER_API_KEY` | OpenRouter API key for LLM access ([get one here](https://openrouter.ai/keys)) |
| `FIRECRAWL_MCP_URL`   | Firecrawl MCP server URL                                                       |

### Optional

| Variable              | Default                      | Description                                    |
| --------------------- | ---------------------------- | ---------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | —                            | Langfuse observability public key              |
| `LANGFUSE_SECRET_KEY` | —                            | Langfuse observability secret key              |
| `LANGFUSE_HOST`       | `https://cloud.langfuse.com` | Langfuse host URL                              |
| `DISABLE_CREDITS`     | `false`                      | Set to `true` to disable credit/token limiting |
| `CORS_ORIGIN`         | `*`                          | Allowed CORS origins                           |

### Backup values (commented, for safekeeping)

| Variable         | Description               |
| ---------------- | ------------------------- |
| `ORACLE_ADDRESS` | Oracle blockchain address |
| `ORACLE_DID`     | Oracle DID                |

---

## Network URLs

The CLI auto-selects infrastructure URLs based on your authenticated network:

| Resource          | Devnet                                          | Testnet                                          | Mainnet                                  |
| ----------------- | ----------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Matrix Homeserver | `https://devmx.ixo.earth`                       | `https://testmx.ixo.earth`                       | `https://mx.ixo.earth`                   |
| Room Bot          | `https://rooms.bot.devmx.ixo.earth`             | `https://rooms.bot.testmx.ixo.earth`             | `https://rooms.bot.mx.ixo.earth`         |
| State Bot         | `https://state.bot.devmx.ixo.earth`             | `https://state.bot.testmx.ixo.earth`             | `https://state.bot.mx.ixo.earth`         |
| Chain RPC         | `https://devnet.ixo.earth/rpc/`                 | `https://testnet.ixo.earth/rpc/`                 | `https://impacthub.ixo.world/rpc/`       |
| SignX             | `https://signx.devnet.ixo.earth`                | `https://signx.testnet.ixo.earth`                | `https://signx.ixo.earth`                |
| Portal            | `https://ixo-portal.vercel.app`                 | `https://ixo-portal.vercel.app`                  | `https://ixo-portal.vercel.app`          |
| Domain Indexer    | `https://domain-indexer.devnet.ixo.earth/index` | `https://domain-indexer.testnet.ixo.earth/index` | `https://domain-indexer.ixo.earth/index` |

**Relayer Node DIDs:**

| Network | DID                                               |
| ------- | ------------------------------------------------- |
| Devnet  | `did:ixo:entity:2f22535f8b179a51d77a0e302e68d35d` |
| Testnet | `did:ixo:entity:3d079ebc0b332aad3305bb4a51c72edb` |
| Mainnet | `did:ixo:entity:2f22535f8b179a51d77a0e302e68d35d` |

---

## Validation Rules

| Input          | Rule                                                     |
| -------------- | -------------------------------------------------------- |
| Project name   | `/^[a-zA-Z][a-zA-Z0-9-_]*$/`, max 50 chars               |
| Matrix URL     | Must start with `http://` or `https://`, no trailing `/` |
| PIN            | Exactly 6 digits                                         |
| Entity DID     | Format: `did:ixo:entity:[a-f0-9]{32}`                    |
| Oracle price   | Must be a number                                         |
| URLs (general) | Must start with `http://` or `https://`                  |

---

## Troubleshooting

### "No wallet found"

Run `qiforge` and select **Login** to authenticate via SignX first. You need the IXO Mobile App.

### QR code not scanning

- Make sure your phone and computer are on the same network
- Try increasing terminal font size or zooming in
- Check that the SignX relay endpoint is reachable for your network

### Entity creation fails at signing

The `MsgCreateEntity` transaction requires signing via the IXO Mobile App. Make sure:

- Your phone has internet connectivity
- You approve the transaction promptly (sessions expire)
- Your wallet has sufficient IXO for gas fees

### "Insufficient funds" during oracle creation

The CLI sends 250,000 uixo (0.25 IXO) from your wallet to fund the new oracle. Make sure your wallet has at least 0.5 IXO (extra for gas fees). Get testnet tokens from the IXO faucet.

### Matrix registration fails

- Verify the Matrix homeserver URL is correct and reachable
- Check that the room bot is running at the expected URL
- The username may already be taken if you previously created an oracle with the same wallet
