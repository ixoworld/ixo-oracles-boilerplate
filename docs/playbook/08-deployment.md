# 08 — Deployment: Ship It

> **What you'll learn:** How to deploy your oracle to production with Docker, configure for the right network, and monitor operations.

---

## Docker

<!-- TODO: Show docker-compose services, Dockerfile.app build process -->

The project includes Docker Compose for infrastructure services (Redis, Nginx) and a `Dockerfile.app` for the oracle application itself.

---

## Production Environment

<!-- TODO: Required vs optional env vars for production, secrets management best practices -->

See [Environment Variables Reference](./reference/environment-variables.md) for the complete list. Key production requirements:
- All Matrix credentials
- `OPEN_ROUTER_API_KEY`
- `NETWORK` set to `testnet` or `mainnet`
- `SECP_MNEMONIC` and `MATRIX_VALUE_PIN`

---

## Network Selection

<!-- TODO: Explain devnet → testnet → mainnet progression -->

| Network | Purpose | When to use |
|---------|---------|-------------|
| devnet | Development & testing | Building and iterating |
| testnet | Staging & QA | Pre-production validation |
| mainnet | Production | Live users and real payments |

Update your entity's network: `oracles-cli update-entity`.

---

## Graceful Shutdown

<!-- TODO: Show the shutdown sequence from main.ts -->

On `SIGTERM` or `SIGINT`, the oracle:

1. Uploads SQLite checkpoints to Matrix (preserving conversation state)
2. Closes the NestJS application
3. Shuts down the MatrixManager
4. Destroys the EditorMatrixClient

This ensures no conversation state is lost during deployments.

---

## Monitoring

<!-- TODO: Langfuse integration setup -->

Configure Langfuse for LLM observability:

```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

---

## Health Checks

<!-- TODO: Show GET / endpoint and how to use it with load balancers -->

`GET /` returns the application status. Use this for Docker health checks and load balancer probes.
