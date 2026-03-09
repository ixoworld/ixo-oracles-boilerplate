# Getting Started with QiForge

Welcome to QiForge! This guide will walk you through building and deploying your first AI-powered oracle on the IXO network.

## 🎯 What You'll Build

We will be building a simple oracle that can do a general conversation with the user.

## 📋 Prerequisites

Before you begin, ensure you have:

- [ ] Node.js 22+ installed
- [ ] pnpm 10+ installed (`npm install -g pnpm`)
- [ ] IXO account on the mobile app
- [ ] Basic understanding of TypeScript/JavaScript
- [ ] Familiarity with LangGraph

## 🚀 Quick Start (5 minutes)

### Step 1: Install QiForge CLI

```bash
npm install -g qiforge-cli
```

### Step 2: Create Your First Oracle

```bash
# Create a new oracle project
qiforge --init

# Follow the interactive prompts from the CLI

```

#### Open your favorite code editor and start building your oracle

1. add to the `.env` file your api keys for `OpenRouter` ...etc.
2. Finally run the app and open web portal(dev-net) to test your app

### Step 3: Deploy with Docker

Your project comes with a ready-to-deploy `Dockerfile`. You can use this file to deploy your oracle to your own infrastructure as you like.

### Step 4: Test Your Oracle

After you have deployed your oracle, you can test it from the **CLI** or the **web portal**.

#### First-time setup (required once per user)

The very first interaction with your oracle **must** happen through the **web portal** or the **QiForge CLI** (`qiforge chat`). This one-time setup:

1. Creates an encrypted Matrix chat room between the user and the oracle.
2. Grants the oracle permission (via a signed AuthZ transaction) to act on the user's behalf.
3. Activates the user's subscription (required for sandbox execution, skills, and other features).

```bash
# Option A: CLI (no browser needed)
qiforge chat

# Option B: Web portal (dev-net)
# Open https://dev.portal.qi.space/oracle/<ORACLE_ENTITY_DID>/connect
```

#### After first-time setup

Once the initial setup is complete, you can continue the conversation with the oracle from any supported client:

- **Web Portal** — full-featured UI with editor, skills, and sandbox
- **QiForge CLI** — `qiforge chat` for quick terminal access
- **Matrix** — any Matrix client (Element, etc.) using the room created during setup
- **Slack** — if the Slack integration is configured

> **Note:** The user must have an active subscription (active or trial) with sufficient credits to use the sandbox, skills, and other premium features. If credits are exhausted the oracle will return a 402 Payment Required error.

## 🧠 Building Your First Oracle

### Define Your Oracle's Purpose

let's start with general conversation flow.

### Create LangGraph Conversation Flow

open `/apps/app/src/graph/nodes/chat-node/prompt.ts` and start defining your prompt.

from `apps/app/src/graph/index.ts` u can remove the `contextGatherNode` to simplify your first oracle flow.
this node is used to connect to the memory engine and get the recent context of the user.

### Add Custom Tools and Functions

refer to langgraph docs for more information on how to add custom tools and functions.

and add them to `apps/app/src/graph/nodes/tools-node/tools.ts`

### Run your oracle

run `pnpm start:dev` to start your oracle.

and open web portal(dev-net) to test your oracle. u can find your oracle in the marketplace or when u ran the cli it should have listed the link for the oracle on the web portal
