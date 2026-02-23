# 05 — Sub-Agents: Compose Specialized Agents

> **What you'll build:** Custom sub-agents that handle specialized tasks, composed into your main oracle via the AgentSpec pattern.

[View agent composition diagram on Excalidraw](https://excalidraw.com/#json=8nYs_BICiMSjBnv59fquy,sB4DZlt1JQ8TXe_Tg0w0eA)

---

## The AgentSpec Interface

From `apps/app/src/graph/agents/subagent-as-tool.ts`:

```typescript
interface AgentSpec {
  name: string;
  description: string;
  tools?: StructuredTool[];
  systemPrompt: string;
  model?: Model;
  middleware?: AgentMiddleware[];
}
```

<!-- TODO: Explain each field with practical guidance -->

---

## createSubagentAsTool()

<!-- TODO: Explain how it wraps an AgentSpec into a callable tool named `call_{name}_agent` -->

Wraps an `AgentSpec` into a `StructuredTool` that the main agent can call like any other tool. The generated tool name follows the pattern `call_{name}_agent`.

---

## Built-in Sub-Agents

<!-- TODO: Expand each with purpose, tools it has access to, and when the main agent invokes it -->

### Memory Agent (`memory-agent.ts`)
User/orgOwner modes, Memory Engine MCP tools, knowledge scopes (user private, org public, org private).

### Portal Agent (`portal-agent.ts`)
Browser tools from client SDK, UI actions.

### Firecrawl Agent (`firecrawl-agent.ts`)
Web scraping and search via Firecrawl MCP server.

### Domain Indexer Agent (`domain-indexer-agent.ts`)
IXO entity search and domain analysis.

### Editor Agent (`editor/editor-agent.ts`)
BlockNote document editing, conditionally loaded when `editorRoomId` is set.

### Skills Agent (`skills-agent/`)
Skills registry interaction — listing and searching available skills.

---

## Create a Custom Sub-Agent

<!-- TODO: Full walkthrough with complete code example -->

### 1. Create the agent file

Create `apps/app/src/graph/agents/my-agent.ts`:

```typescript
// TODO: Complete example
```

### 2. Define system prompt + tools

<!-- TODO: Show practical example -->

### 3. Return AgentSpec

<!-- TODO: Show the factory function pattern -->

### 4. Register in main-agent.ts

<!-- TODO: Show how to add to Promise.all, wrap with createSubagentAsTool, add to tools array -->

---

## Removing Unused Sub-Agents

<!-- TODO: Explain commenting out from Promise.all to reduce latency and token usage -->

Comment out unused sub-agents from the `Promise.all` block in `main-agent.ts` to reduce startup latency and avoid registering tools the LLM won't need.
