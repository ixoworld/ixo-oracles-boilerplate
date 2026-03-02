# 07 — MCP Servers: Connect External Tools

> **What you'll learn:** How to plug external tools into your oracle so it can do more things — search the web, run code, remember past conversations, and anything else an MCP server provides.

---

## 7.1 What is MCP?

A way to plug external tools into your oracle, like connecting apps to a phone. You add a server URL, and your oracle automatically discovers what tools are available.

---

## 7.2 Built-in Connections

Your oracle ships with these MCP integrations out of the box:

| Server            | Scope    | What it gives your oracle                             |
| ----------------- | -------- | ----------------------------------------------------- |
| **Memory Engine** | Per-user | Remembers things about each user across conversations |
| **Firecrawl**     | Global   | Searches and scrapes the web for information          |
| **Sandbox**       | Per-user | Runs code securely when executing skills              |
| **Subscription**  | Per-user | Checks user credits and subscription status           |

**Scope explained:**

- **Global** — one shared connection for all users
- **Per-user** — each user gets their own isolated connection (with their own credentials and data)

---

## 7.3 Adding a New MCP Server

Open `apps/app/src/graph/mcp.ts` and add your server to the `mcpServers` object:

```typescript
const mcpConfig: MCPConfigWithUCAN = {
  useStandardContentBlocks: true,
  prefixToolNameWithServerName: true,
  mcpServers: {
    // Add your server here
    myService: {
      type: 'http',
      transport: 'http',
      url: 'https://my-mcp-server.com/mcp',
      headers: {
        Authorization: `Bearer ${process.env.MY_SERVICE_API_KEY}`,
      },
    },
  },
  ucanConfig: {
    // If your server needs per-user authorization, add it here
    // myService: { requiresUcan: true },
  },
};
```

That's it. Restart your oracle and it will pick up all the tools from the new server automatically. Tool names get prefixed with the server name (e.g., `myService__searchDocs`), so there are no naming conflicts.

### Server types

| Type      | When to use                              | Example                           |
| --------- | ---------------------------------------- | --------------------------------- |
| `http`    | Remote MCP server with a URL             | Third-party APIs, hosted services |
| `command` | Local process that speaks MCP over stdio | Docker containers, CLI tools      |

**Command-based example:**

```typescript
mcpServers: {
  github: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
    },
  },
},
```

## Quick reference

| I want to...                          | Do this                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| Add a new external tool               | Add a server entry to `mcpServers` in `apps/app/src/graph/mcp.ts` |
| Require user permissions for a server | Add the server name to `ucanConfig` with `requiresUcan: true`     |
| See which tools loaded                | Check the oracle logs on startup for the MCP tool count           |
