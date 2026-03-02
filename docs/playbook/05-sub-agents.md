# 05 — Sub-Agents

> **What you'll learn:** What sub-agents are, which ones come built-in, and how to create your own.

---

## What are Sub-Agents?

Your oracle can delegate tasks to specialist agents. Think of them as team members with different skills — one handles web scraping, another manages memory, another edits documents — and the main oracle decides who to call based on what the user asked.

---

## Built-in Sub-Agents

Your oracle ships with these sub-agents out of the box:

| Sub-Agent                | What it does                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Memory Agent**         | Retrieves user context (identity, goals, recent activity) to personalize responses                       |
| **Portal Agent**         | Handles browser and UI interactions from the client SDK                                                  |
| **Firecrawl Agent**      | Web scraping and search via Firecrawl                                                                    |
| **Domain Indexer Agent** | Searches IXO entities and analyzes domains                                                               |
| **Editor Agent**         | Edits BlockNote documents (only active when an editor room is open)                                      |
| **Skills Agent**         | Lists and searches available skills from the [ai-skills registry](https://github.com/ixoworld/ai-skills) |

You don't need to configure these — they're already wired into your oracle. The main agent calls them automatically when it decides a task fits their specialty.

> For more on skills, see [04 — Working with Skills](./04-working-with-skills.md).

---

## Creating a Custom Sub-Agent

A sub-agent is defined by an `AgentSpec` — an object with a name, description, tools, and a system prompt. The framework wraps it into a tool that the main agent can call.

Here's the shape of an `AgentSpec`:

```typescript
interface AgentSpec {
  name: string; // e.g. "Weather Agent"
  description: string; // One line: what it does
  tools?: StructuredTool[];
  systemPrompt: string; // Instructions for this agent
  model?: Model;
  middleware?: AgentMiddleware[];
}
```

### Example: A Weather Agent

Create a new file at `apps/app/src/graph/agents/weather-agent.ts`:

```typescript
import { getOpenRouterChatModel } from '@ixo/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AgentSpec } from './subagent-as-tool';

const llm = getOpenRouterChatModel({
  model: 'openai/gpt-oss-120b:nitro',
  __includeRawResponse: true,
});

// A simple tool this agent can use
const getWeatherTool = tool(
  async ({ city }) => {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
    );
    const data = await res.json();
    const current = data.current_condition[0];
    return `${city}: ${current.temp_C}°C, ${current.weatherDesc[0].value}`;
  },
  {
    name: 'get_weather',
    description: 'Get current weather for a city.',
    schema: z.object({
      city: z.string().describe('City name, e.g. "London"'),
    }),
  },
);

export const createWeatherAgent = async (): Promise<AgentSpec> => {
  return {
    name: 'Weather Agent',
    description:
      'Gets current weather information for any city. Use when the user asks about weather.',
    tools: [getWeatherTool],
    systemPrompt: `You are a weather assistant. When asked about weather, use the get_weather tool to fetch current conditions and give a brief, friendly summary.`,
    model: llm,
    middleware: [],
  };
};
```

That's it. The `AgentSpec` tells the framework everything it needs: what the agent is called, when to use it, what tools it has, and how it should behave.

---

## Wiring It Up

Open `apps/app/src/graph/agents/main-agent.ts` and make three changes:

### 1. Import your agent

At the top of the file, add:

```typescript
import { createWeatherAgent } from './weather-agent';
```

### 2. Create the agent in the `Promise.all` block

Find the `Promise.all` that creates the existing agents and add yours:

```typescript
const [
  systemPrompt,
  portalAgent,
  memoryAgent,
  firecrawlAgent,
  domainIndexerAgent,
  mcpTools,
  sandboxTools,
  weatherAgent,            // <-- add this
] = await Promise.all([
  AI_ASSISTANT_PROMPT.format({ ... }),
  createPortalAgent({ ... }),
  createMemoryAgent({ ... }),
  createFirecrawlAgent(),
  createDomainIndexerAgent(),
  getMcpTools(),
  sandboxMCP?.getTools() ?? Promise.resolve([]),
  createWeatherAgent(),    // <-- add this
]);
```

### 3. Wrap it and add to the tools array

Right after the existing `createSubagentAsTool` calls, add:

```typescript
const callWeatherAgentTool = createSubagentAsTool(weatherAgent);
```

Then add `callWeatherAgentTool` to the `tools` array in `createAgent`:

```typescript
const agent = createAgent({
  // ...
  tools: [
    // ...existing tools...
    callWeatherAgentTool, // <-- add this
  ],
});
```

Restart your oracle and it can now answer weather questions by delegating to your new sub-agent.

---

## When to Use a Sub-Agent vs. a Skill vs. a Tool

| Use a...        | When...                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill**       | You want to add a new capability without changing oracle code. Skills are files in a registry — no deploys needed.                           |
| **Custom tool** | You need a single function (e.g., call an API). See [04 — Custom Tools](./04-working-with-skills.md#custom-tools--when-skills-arent-enough). |
| **Sub-agent**   | You need a specialist that has its own tools, prompt, and reasoning — more than a single function call.                                      |

Most of the time, **skills are the right choice**. Use sub-agents when the task requires multi-step reasoning with its own set of tools.

---

## Next Steps

- **[04 — Working with Skills](./04-working-with-skills.md)** — the primary way to extend your oracle
- **[03 — Customize Your Oracle](./03-customize-your-oracle.md)** — change your oracle's personality and behavior
