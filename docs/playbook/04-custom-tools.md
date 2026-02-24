# 04 — Custom Tools: Teach It New Skills

> **What you'll build:** Custom LangGraph tools that extend your oracle's capabilities — API calls, database queries, computations, and more.

---

## What Are LangGraph Tools

<!-- TODO: Explain the tool concept: function + Zod schema + name + description. The LLM decides when to call them. -->

A tool is a function the LLM can invoke. Each tool has a name, description (so the LLM knows when to use it), a Zod input schema (for validation), and an async handler.

---

## Existing Tool Patterns

<!-- TODO: Show listSkillsTool from skills-tools.ts as a reference pattern -->
<!-- TODO: Show domainIndexerSearchTool from tools.ts as another pattern -->

---

## Step-by-Step: Create a Tool

<!-- TODO: Complete walkthrough with code -->

1. **Define the Zod input schema** — what parameters your tool accepts
2. **Write the async handler** — what the tool does when called
3. **Wrap with `tool()`** — from `@langchain/core/tools`
4. **Provide metadata** — name, description, schema

```typescript
// Example structure (fill in with real example)
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const myToolSchema = z.object({
  // TODO: define inputs
});

export const myTool = tool(
  async (input) => {
    // TODO: implement
  },
  {
    name: 'my_tool',
    description: 'What this tool does and when to use it',
    schema: myToolSchema,
  },
);
```

---

## Register with the Agent

<!-- TODO: Show where to add the tool in main-agent.ts (tools array at line ~255) -->

Add your tool to the `tools` array in `createMainAgent()` at `apps/app/src/graph/agents/main-agent.ts`.

---

## Complete Example

<!-- TODO: Build a practical tool (e.g., weather lookup, database query, external API call) -->

---

## Tool Validation Middleware

<!-- TODO: Explain how tool-validation-middleware.ts catches Zod errors automatically -->

The tool validation middleware (`apps/app/src/graph/middlewares/tool-validation-middleware.ts`) automatically catches Zod schema validation errors and returns helpful error messages to the LLM, allowing it to retry with corrected parameters.

---

## MCP Tools vs Direct Tools

<!-- TODO: When to use each approach -->

- **Direct tools** — for custom business logic specific to your oracle
- **MCP tools** — for connecting to external services or reusing existing MCP server implementations

See [07 — MCP Servers](./07-mcp-servers.md) for connecting external MCP services.
