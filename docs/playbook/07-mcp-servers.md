# 07 — MCP Servers: Connect External Services

> **What you'll build:** Connections to external MCP (Model Context Protocol) servers, giving your oracle access to third-party tools and services.

---

## What is MCP

<!-- TODO: Brief explanation of Model Context Protocol -->

MCP (Model Context Protocol) is a standard way to connect LLMs to external tools. Instead of writing custom tool integrations, you point your oracle at an MCP server and it discovers available tools automatically.

---

## The mcpConfig in mcp.ts

<!-- TODO: Show the MCPConfigWithUCAN structure from mcp.ts -->

Located in `apps/app/src/graph/mcp.ts`. The config defines which MCP servers to connect to and which require UCAN authorization.

---

## Adding an MCP Server

<!-- TODO: Show step-by-step with code example -->

Edit the `mcpServers` object in `mcp.ts`:

```typescript
mcpServers: {
  myService: {
    type: 'http',
    transport: 'http',
    url: 'https://my-mcp-server.com/mcp',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  },
}
```

---

## UCAN-Protected Servers

<!-- TODO: Explain ucanConfig and when to use it -->

Add to the `ucanConfig` object for servers that require client-side authorization via UCAN tokens.

---

## Per-User MCP Servers

<!-- TODO: Show the sandbox pattern from main-agent.ts lines 99-121 -->

Some MCP servers need per-user authentication. The sandbox pattern creates a new MCP client per request with user-specific headers (Matrix OpenID token, user DID, room ID).

---

## Existing MCP Integrations

<!-- TODO: Expand each with configuration and purpose -->

| Server | Scope | Purpose |
|--------|-------|---------|
| Memory Engine | Per-user | Persistent memory across conversations |
| Firecrawl | Global | Web scraping and search |
| Sandbox | Per-user | Client-provided tools with OpenID auth |
