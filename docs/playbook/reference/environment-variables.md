# Reference: Environment Variables

> Complete reference for all environment variables, from `apps/app/src/config.ts` EnvSchema.

---

## General

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | Server port |
| `ORACLE_NAME` | Yes | — | Oracle display name |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins |

## Matrix

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MATRIX_BASE_URL` | Yes | — | Matrix homeserver URL |
| `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN` | Yes | — | Oracle admin access token |
| `MATRIX_ORACLE_ADMIN_USER_ID` | Yes | — | Oracle Matrix user ID |
| `MATRIX_ORACLE_ADMIN_PASSWORD` | Yes | — | Oracle Matrix password |
| `MATRIX_RECOVERY_PHRASE` | Yes | — | Cross-signing recovery phrase |
| `MATRIX_CRYPTO_STORE_PATH` | No | `./matrix-storage` | Path for crypto store |
| `MATRIX_STORE_PATH` | No | `./matrix-store-new` | Path for Matrix store |
| `MATRIX_SECRET_STORAGE_KEYS_PATH` | No | `./matrix-secret-storage-keys-new2` | Secret storage keys path |
| `MATRIX_ACCOUNT_ROOM_ID` | Yes | — | Oracle's Matrix account room |
| `MATRIX_VALUE_PIN` | Yes | — | PIN for encrypted vault access |
| `SKIP_LOGGING_CHAT_HISTORY_TO_MATRIX` | No | — | Skip Matrix message logging |

## Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | No | `postgres` | PostgreSQL username |
| `POSTGRES_HOST` | No | `localhost` | PostgreSQL host |
| `POSTGRES_DB` | No | `knowledge` | PostgreSQL database name |
| `POSTGRES_PASSWORD` | No | `postgres` | PostgreSQL password |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |
| `DATABASE_USE_SSL` | No | `false` | Enable SSL for database |
| `CHROMA_URL` | No | `http://localhost:8000` | ChromaDB server URL |
| `CHROMA_COLLECTION_NAME` | No | `knowledge` | ChromaDB collection name |
| `SQLITE_DATABASE_PATH` | Yes | — | SQLite checkpoint database path |
| `REDIS_URL` | Yes | — | Redis connection URL |

## AI / LLM

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPEN_ROUTER_API_KEY` | Yes | — | OpenRouter API key for LLM access |
| `OPENAI_API_KEY` | No | — | OpenAI key (for embeddings) |

## Blockchain

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NETWORK` | Yes | — | `mainnet`, `testnet`, or `devnet` |
| `RPC_URL` | Yes | — | Blockchain RPC endpoint |
| `SECP_MNEMONIC` | Yes | — | Oracle wallet mnemonic |
| `ORACLE_ENTITY_DID` | Yes | — | Oracle entity DID |
| `BLOCKSYNC_URI` | No | — | Blocksync API URI |

## External Services

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEMORY_MCP_URL` | Yes | — | Memory Engine MCP server URL |
| `MEMORY_ENGINE_URL` | Yes | — | Memory Engine API URL |
| `FIRECRAWL_MCP_URL` | Yes | — | Firecrawl MCP server URL |
| `DOMAIN_INDEXER_URL` | Yes | — | Domain Indexer API URL |
| `SANDBOX_MCP_URL` | Yes | — | Sandbox MCP server URL |
| `SUBSCRIPTION_URL` | No | — | Subscription service URL |
| `SUBSCRIPTION_ORACLE_MCP_URL` | No | — | Subscription oracle MCP URL |
| `LIVE_AGENT_AUTH_API_KEY` | No | `''` | Live agent authentication key |

## Slack

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_OAUTH_TOKEN` | No | — | Slack bot OAuth token |
| `SLACK_APP_TOKEN` | No | — | Slack app token (Socket Mode) |
| `SLACK_USE_SOCKET_MODE` | No | `true` | Enable Socket Mode |
| `SLACK_MAX_RECONNECT_ATTEMPTS` | No | `10` | Max reconnection attempts |
| `SLACK_RECONNECT_DELAY_MS` | No | `1000` | Delay between reconnections (ms) |

## Features

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISABLE_CREDITS` | No | `false` | Set to `true` to disable credit/token limiting |

## Observability

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LANGFUSE_PUBLIC_KEY` | No | — | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | No | — | Langfuse secret key |
| `LANGFUSE_HOST` | No | — | Langfuse host URL |
