# Troubleshooting

Common issues and how to fix them.

---

## Setup & Installation

### `qiforge: command not found`

The CLI isn't installed globally, or your system can't find it.

**Fix:**

1. Reinstall: `npm install -g qiforge-cli`
2. Check that your global npm bin directory is in your PATH: run `npm bin -g` to see where it installs
3. If you used `pnpm`, try: `pnpm add -g qiforge-cli`

### Docker issues

**"Cannot connect to the Docker daemon"**

Docker Desktop isn't running. Open Docker Desktop and wait for it to start, then try again.

**Ports already in use**

Another process is using a port that Docker needs (usually 6379 for Redis or 8001 for RedisInsight).

```bash
# See what's using the port
lsof -i :6379

# Stop existing Docker containers
docker compose down
```

**"permission denied" on Linux**

Your user isn't in the Docker group. Run: `sudo usermod -aG docker $USER`, then log out and back in.

### Build fails

If `pnpm build` fails after a fresh install:

```bash
# Clear everything and start fresh
rm -rf node_modules
pnpm install
pnpm build
```

If you still see errors, make sure you're on Node.js 22+ (`node --version`) and pnpm 10+ (`pnpm --version`).

---

## Authentication

### SignX / wallet connection issues

**QR code won't scan**

- Make sure your phone camera has a clear view of the terminal QR code
- Try making your terminal window larger (bigger QR code = easier to scan)
- Check that you're using the IXO Mobile App, not a generic QR scanner

**"Authentication failed" or "Session expired"**

- Re-run `qiforge` and select "Login" to get a fresh session
- Make sure the IXO Mobile App is up to date
- Check your internet connection on both your computer and phone

### Matrix token errors

**"Matrix connection failed"**

Check these values in your `apps/app/.env`:

- `MATRIX_BASE_URL` — the Matrix homeserver must be reachable from your machine
- `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN` — must be a valid token (generated during `qiforge --init`)
- `MATRIX_ORACLE_ADMIN_USER_ID` — must match the user ID for your oracle's Matrix account

If you changed networks (e.g., devnet to testnet), you need to re-run `qiforge --init` to generate new Matrix credentials.

---

## Running Your Oracle

### Port already in use

**"EADDRINUSE: address already in use :::4000"**

Something else is running on port 4000 (or whatever port you configured).

**Fix:**

```bash
# Find what's using the port
lsof -i :4000

# Kill it (replace PID with the actual process ID)
kill PID
```

Or change the port in your `.env` file:

```env
PORT=4001
```

### Missing environment variables

**"OPEN_ROUTER_API_KEY is required"**

You haven't added your OpenRouter API key to `apps/app/.env`. Open the file and add:

```env
OPEN_ROUTER_API_KEY=sk-or-v1-your-key-here
```

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

**Other missing variables**

If `qiforge --init` ran successfully, most variables are already filled in. Check the [Environment Variables reference](./environment-variables.md) — variables marked as **CLI** source should already be set. Only **Manual** source variables need to be added by you.

### Oracle not responding

**Server starts but messages get no response**

1. Check the terminal where `pnpm dev` is running — look for error messages
2. Verify your `OPEN_ROUTER_API_KEY` is valid and has credits
3. Make sure Docker services are running: `docker ps` should show Redis
4. Try restarting: stop the server (Ctrl+C), then run `pnpm dev` again

**Server starts but crashes immediately**

- Check the error message in the terminal — it usually points to a missing env var or unreachable service
- Make sure Redis is running: `pnpm infra:up` from the `apps/app` directory
- Verify your Matrix homeserver is reachable: try opening `MATRIX_BASE_URL` in a browser

---

## Messaging

### Empty responses from oracle

- Your LLM API key might be invalid or out of credits — check at [openrouter.ai/activity](https://openrouter.ai/activity)
- Try a fresh session by using a new session ID
- Check the server logs for errors related to the LLM call

### LLM API errors

**"429 Too Many Requests"**

You've hit the rate limit on your LLM provider. Wait a minute and try again, or upgrade your OpenRouter plan.

**"401 Unauthorized"**

Your API key is invalid. Double-check the `OPEN_ROUTER_API_KEY` value in your `.env` file. It should start with `sk-or-v1-`.

**"Model not found"**

The model specified in your configuration isn't available on OpenRouter. Check [openrouter.ai/models](https://openrouter.ai/models) for available models.

---

## Deployment

### Common cloud deployment issues

**Environment variables not set**

Most cloud platforms have a separate section for environment variables (sometimes called "secrets" or "config vars"). Make sure all required variables from your local `.env` are set in your cloud platform's config.

**Health check failing**

Your cloud platform might be checking the wrong port or path. The health endpoint is `GET /` on whatever port your oracle runs on (default: 3000).

**Oracle can't reach external services**

Make sure your cloud deployment can access:

- Your Matrix homeserver (`MATRIX_BASE_URL`)
- OpenRouter API (`api.openrouter.ai`)
- The IXO blockchain RPC (`RPC_URL`)
- MCP servers (Memory Engine, Firecrawl, Sandbox)

Some cloud platforms restrict outbound traffic — check your platform's networking settings.

**Docker services in production**

You'll need a managed Redis instance instead of the local Docker one. Update `REDIS_URL` in your production environment to point to your managed Redis.

---

## Still stuck?

- Check the server logs (the terminal where `pnpm dev` is running) — most errors are logged there
- Visit the [Swagger docs](http://localhost:4000/docs) to test API endpoints interactively
- Search for your error message in the [GitHub issues](https://github.com/ixoworld/qiforge/issues)
