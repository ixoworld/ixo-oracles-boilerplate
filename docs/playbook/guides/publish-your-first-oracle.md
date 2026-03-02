# Publish Your First Oracle

> **Time:** ~30 minutes
> **What you'll build:** A "Research Buddy" oracle that can search the web, summarize documents, and organize knowledge — live on the network, accessible to anyone you share it with.

---

## What You'll Build

By the end of this guide, you'll have a working oracle that:

- Has its own identity on the blockchain
- Responds to users through the [Portal](https://ixo-portal.vercel.app)
- Uses skills to search the web, summarize content, and format citations
- Runs in the cloud, available 24/7

Think of it like publishing a chatbot — except this one has a blockchain identity, encrypted conversations, and can learn new abilities through skills.

---

## Step 1: Scaffold Your Project

If you haven't set up a project yet, follow the full walkthrough in [Chapter 01 — Quickstart](../01-quickstart.md). It covers installing the CLI, scaffolding, configuring environment variables, and getting your oracle running locally.

Once you've completed the quickstart, come back here.

> **Already have a project?** Skip ahead to [Step 2](#step-2-customize-your-oracle).

---

## Step 2: Customize Your Oracle

Your oracle's personality is defined by two things: its **name** and its **system prompt**.

### Set the name

Open `apps/app/src/graph/agents/main-agent.ts` and find this line:

```typescript
APP_NAME: 'My Oracle',
```

Change it to your oracle's name:

```typescript
APP_NAME: 'Research Buddy',
```

### Edit the system prompt

Open `apps/app/src/graph/nodes/chat-node/prompt.ts` and update the opening line of the `AI_ASSISTANT_PROMPT` template to describe what your oracle does:

```
You are a meticulous research assistant powered by {{APP_NAME}}. You help users find, verify, and synthesize information. Always cite your sources and present findings in a clear, structured format.
```

For a deeper look at all the things you can customize (prompt sections, LLM model, communication style), see [Chapter 03 — Customize Your Oracle](../03-customize-your-oracle.md).

---

## Step 3: Add a Skill

Skills are like apps for your oracle — each one gives it a new ability. Your oracle can browse and install skills on the fly from the [skills registry](https://github.com/ixoworld/ai-skills).

The easiest way to explore available skills is to ask your oracle directly (once it's running):

```
"What skills do you have available?"
"Search for skills related to web research"
"List all available skills"
```

The oracle has built-in tools (`list_skills` and `search_skills`) that let it browse the registry and pick up new abilities without any code changes from you.

For a full guide on browsing, using, and building skills, see [Chapter 04 — Working with Skills](../04-working-with-skills.md).

---

## Step 4: Test Locally

Start your oracle in development mode:

```bash
pnpm dev
```

Once it's running, send it a test message:

```bash
curl -X POST http://localhost:3000/messages/test-session-1 \
  -H "Content-Type: application/json" \
  -d '{"message": "Hi! Can you search for recent papers on climate change adaptation?"}'
```

You should get a response back from your Research Buddy. Try a few more messages to make sure it behaves the way you want:

```bash
# Test skill discovery
curl -X POST http://localhost:3000/messages/test-session-1 \
  -H "Content-Type: application/json" \
  -d '{"message": "What skills do you have available?"}'

# Test a specific capability
curl -X POST http://localhost:3000/messages/test-session-1 \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarize this article: https://example.com/some-article"}'
```

**Things to check:**

- Does the oracle introduce itself correctly (using your `APP_NAME`)?
- Can it discover and use skills from the registry?
- Are responses helpful and on-topic for your use case?

If something isn't right, tweak the system prompt in `prompt.ts` and restart with `pnpm dev`.

---

## Step 5: Deploy

Once you're happy with how your oracle works locally, it's time to push it to the cloud so it runs 24/7.

Follow the deployment steps in [Chapter 08 — Deployment](../08-deployment.md).

> **Note:** The recommended cloud platform is [Fly.io](https://fly.io). See [Chapter 08 — Deployment](../08-deployment.md) for the full walkthrough.

---

## Step 6: Register On-Chain

Your oracle was registered on the blockchain during the initial `qiforge --init` step in the quickstart. This gave it a DID (decentralized identity) and an on-chain entity.

If you need to update your oracle's metadata or switch networks later, use:

```bash
qiforge update-entity
```

This lets you change the oracle's name, description, or other on-chain details without starting over.

For the full list of CLI commands, see the [CLI Reference](../reference/cli-reference.md).

---

## Step 7: Share It

Your oracle is live. Here's how to get it in front of users:

1. **Get the portal URL** — Your oracle is accessible through the Portal at:

   ```
   https://ixo-portal.vercel.app
   ```

   Users connect to your oracle through this portal using the mobile app for authentication.

2. **Share the oracle's DID** — Every oracle has a unique DID (created during registration). Share this with anyone who needs to find your oracle on the network.

3. **First-time users** must connect through the web portal first — this sets up their encrypted conversation room and grants the necessary permissions. After that, they can also interact via Matrix or Slack clients.

---

## Troubleshooting

### Oracle won't start (`pnpm dev` fails)

- **Missing environment variables** — Check that your `.env` file has all required values. See the [Environment Variables Reference](../reference/environment-variables.md) for the full list.
- **Docker not running** — The oracle needs Redis and Nginx. Start them with `pnpm db:up` from the `apps/app` directory.
- **Port already in use** — Another process is using port 3000. Stop it or change the port in your `.env`.

### Oracle responds but ignores skills

- Skills are fetched from the remote registry. Make sure your oracle has internet access.
- Try asking explicitly: *"Search for skills related to [topic]"* — this triggers the skill discovery tools.
- Check that the `OPENROUTER_API_KEY` (or your LLM API key) is valid — skill execution requires LLM reasoning.

### `qiforge` command not found

- Reinstall the CLI: `npm install -g qiforge-cli`
- Make sure your global npm bin directory is in your PATH. Run `npm bin -g` to check the location.

### Registration or entity update fails

- Make sure you have the IXO Mobile App ready for SignX authentication.
- Check your internet connection — registration writes to the blockchain and needs network access.
- If you're on testnet, make sure you have testnet tokens (the CLI handles this during init).

### Messages return errors or empty responses

- Check the terminal where `pnpm dev` is running for error logs.
- Verify your LLM API key is valid and has credits.
- Try a fresh session by using a new session ID in the URL: `/messages/new-session-id`.

---

## What's Next?

- **Add more skills** — Browse the [skills registry](https://github.com/ixoworld/ai-skills) or [build your own](../04-working-with-skills.md)
- **Set up payments** — Monetize your oracle with the [Payments & Claims Guide](./payments-and-claims.md)
- **Add memory** — Give your oracle persistent memory with the [Memory Engine Guide](./memory-engine.md)
- **Deep customization** — Tweak the system prompt, add sub-agents, or configure middlewares in [Chapter 03](../03-customize-your-oracle.md)
