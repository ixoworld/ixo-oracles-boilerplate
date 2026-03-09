# Publish Your First Oracle

> **Time:** ~30 minutes
> **What you'll build:** A "Research Buddy" oracle that can search the web, summarize documents, and organize knowledge — live on the network, accessible to anyone you share it with.

---

## What You'll Build

By the end of this guide, you'll have a working oracle that:

- Has its own identity on the blockchain
- Responds to users through the [Portal](https://dev.portal.qi.space)
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

### Quick test with `qiforge chat` (recommended)

The fastest way to test is the built-in chat command. Open a second terminal and run:

```bash
qiforge chat
```

You'll get an interactive conversation right in your terminal:

```
$ qiforge chat

  Connected to Research Buddy by MyOrg — A meticulous research assistant
  Session: f7a291c3-8e42
  Type 'exit' to quit.

Research Buddy > Hi! Can you search for recent papers on climate change adaptation?

  I found several recent papers on climate change adaptation.
  Here are the top results:

  1. "Urban Adaptation Strategies for Rising Sea Levels" (2025)
     — Journal of Environmental Planning...

Research Buddy > What skills do you have available?

  I have access to skills for web research, document summarization,
  citation formatting, and more. Would you like me to search for
  something specific?

Research Buddy > exit

  Session ended. Goodbye!
```

### Alternative: curl

You can also test with curl _(a terminal tool for sending web requests)_, but you'll need auth headers. See the [API Endpoints reference](../reference/api-endpoints.md) for details.

**Things to check:**

- Does the oracle introduce itself correctly (using your `APP_NAME`)?
- Can it discover and use skills from the registry?
- Are responses helpful and on-topic for your use case?

If something isn't right, tweak the system prompt in `prompt.ts` and restart with `pnpm dev`.

---

## Step 5: Deploy to Devnet

Once you're happy with how your oracle works locally, deploy it so it runs 24/7.

1. **Deploy your project** to a cloud provider (Railway, Fly.io, etc.) — see [Chapter 08 — Deployment](../08-deployment.md) for the full walkthrough.

2. **You'll get a public URL** like `https://my-oracle.fly.dev`

3. **Update your oracle's API URL on-chain:**

   ```bash
   qiforge update-oracle-api-url
   ```

   - It will ask for your Entity DID (from your `.env`: `ORACLE_ENTITY_DID`)
   - Enter your new public URL
   - Sign the transaction with your IXO Mobile App

4. Now anyone on devnet can find and use your oracle through the portal!

---

## Step 6: Share It

Your oracle is live. Here's how to get it in front of users:

1. **Share the portal link** — send users directly to your oracle:

   ```
   https://dev.portal.qi.space/oracle/{ORACLE_ENTITY_DID}/connect
   ```

   Replace `{ORACLE_ENTITY_DID}` with the value from your `.env` file.

2. **First-time users** click **Connect**, sign with the IXO Mobile App, and start chatting. This one-time step creates their encrypted room and grants permissions. After that, they can also interact via Matrix or Slack.

3. **Share the oracle's DID** — for developers or integrations, the DID is the unique identifier for your oracle on the network.

---

## Step 7: Go to Mainnet (when ready)

When you're ready to go live on the production network:

1. **Log in with your mainnet account:**

   ```bash
   qiforge    # select Login, choose mainnet
   ```

2. **Create a new entity on mainnet:**

   ```bash
   qiforge create-entity
   ```

3. The CLI will print your new oracle secrets (Matrix credentials, mnemonic, etc.)

4. **Copy the new secrets into your `.env`:**
   - Back up your devnet `.env` first (e.g., rename it to `.env.devnet`)
   - The CLI generates the new credentials — copy them into `apps/app/.env`

5. **Redeploy** your project with the new `.env`

6. **Update the API URL on mainnet:**

   ```bash
   qiforge update-oracle-api-url
   ```

   Enter the Entity DID from your new mainnet `.env` and your deployment URL.

7. Done! Your oracle is live on mainnet. Users can find it at:

   ```
   https://portal.qi.space/oracle/{MAINNET_ENTITY_DID}/connect
   ```

---

## Troubleshooting

### Oracle won't start (`pnpm dev` fails)

- **Missing environment variables** — Check that your `.env` file has all required values. See the [Environment Variables Reference](../reference/environment-variables.md) for the full list.
- **Docker not running** — If you have credits enabled, Redis needs to be running. Start it with `pnpm infra:up` from the root directory.
- **Port already in use** — Another process is using port 4000. Stop it or change the `PORT` in your `.env`.

### Oracle responds but ignores skills

- Skills are fetched from the remote registry. Make sure your oracle has internet access.
- Try asking explicitly: _"Search for skills related to [topic]"_ — this triggers the skill discovery tools.
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
