# 03 — Customize Your Oracle

> **Time:** ~10 minutes
> **What you'll do:** Give your oracle a unique identity, personality, and purpose by editing two files: the system prompt and the model config.

---

## 03.1 — Oracle Name

Your oracle's name is set in `apps/app/src/graph/agents/main-agent.ts`. Find this line:

```typescript
APP_NAME: 'My Oracle',
```

Change it to your oracle's name:

```typescript
APP_NAME: 'Acme Support',
```

This value is injected into the system prompt as `{{APP_NAME}}` — the AI refers to itself by this name.

---

## 03.2 — System Prompt

The system prompt is the master instruction set that tells your oracle how to think and respond. It lives in:

```
apps/app/src/graph/nodes/chat-node/prompt.ts
```

### What it does

The prompt is a template with placeholders (variables) that get filled in automatically at runtime. You do not need to hardcode user-specific information — the framework injects it for you.

### Variables injected at runtime

| Variable                       | Filled by       | What it contains                                 |
| ------------------------------ | --------------- | ------------------------------------------------ |
| `APP_NAME`                     | `main-agent.ts` | Your oracle's name                               |
| `IDENTITY_CONTEXT`             | Memory Agent    | Who the user is (name, preferences)              |
| `WORK_CONTEXT`                 | Memory Agent    | What the user works on                           |
| `GOALS_CONTEXT`                | Memory Agent    | What the user is trying to achieve               |
| `INTERESTS_CONTEXT`            | Memory Agent    | User's interests and expertise                   |
| `RELATIONSHIPS_CONTEXT`        | Memory Agent    | User's social/professional context               |
| `RECENT_CONTEXT`               | Memory Agent    | Recent conversation history                      |
| `TIME_CONTEXT`                 | System          | Current date and time                            |
| `CURRENT_ENTITY_DID`           | State           | The blockchain entity the user is viewing        |
| `EDITOR_DOCUMENTATION`         | Conditional     | Included when the user has an editor open        |
| `AG_UI_TOOLS_DOCUMENTATION`    | Conditional     | Included when interactive UI tools are available |
| `SLACK_FORMATTING_CONSTRAINTS` | Conditional     | Included when the user is chatting from Slack    |

The Memory Agent variables are the reason your oracle feels personal — it remembers each user across conversations and adapts its responses.

### How to customize the prompt

Open `prompt.ts` and look for the `AI_ASSISTANT_PROMPT` template. The template is long (~780 lines) because it covers skills, agent tools, and all the operational modes. You do not need to rewrite the whole thing.

**Safe places to customize:**

1. **The opening line** — Change the oracle's self-description at the very top of the template:

```typescript
// Find this line:
`You are a skills-native AI companion powered by {{APP_NAME}}.`
// Change it to match your oracle's personality:
`You are a friendly customer support specialist for {{APP_NAME}}.`;
```

2. **The communication style section** — Look for the "Communication" heading and adjust the tone:

```typescript
// Original:
// - Use human-friendly language, never expose technical field names
// - Match user's communication style and expertise level

// For a more formal oracle, you might change it to:
// - Use professional, courteous language
// - Always address the user by name when known
// - Keep responses concise and action-oriented
```

3. **The core capabilities section** — Edit the "Core Capabilities" heading to describe what YOUR oracle does instead of the generic defaults.

**Leave these sections alone** unless you know what you are doing:

- The priority hierarchy (controls how the AI weighs instructions)
- The skills system section (controls file creation workflows)
- The agent tools reference (controls how sub-agents are called)
- The conditional blocks for editor/Slack/AG-UI modes

---

## 03.3 — Model Selection

Your oracle uses an LLM through [OpenRouter](https://openrouter.ai/models), which gives you access to models from OpenAI, Anthropic, Google, Meta, and others — all through a single API key.

The model is configured in `apps/app/src/graph/agents/main-agent.ts`:

```typescript
const llm = getOpenRouterChatModel({
  model: 'openai/gpt-oss-120b:nitro',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});
```

### Switching models

Change the `model` field to any model available on OpenRouter. Some popular choices:

| Model                           | Best for                          | Relative cost |
| ------------------------------- | --------------------------------- | ------------- |
| `openai/gpt-4o`                 | General purpose, fast             | Medium        |
| `anthropic/claude-sonnet-4`     | Nuanced reasoning, long context   | Medium        |
| `anthropic/claude-opus-4`       | Complex analysis, highest quality | High          |
| `google/gemini-2.5-pro-preview` | Large context windows, multimodal | Medium        |
| `meta-llama/llama-4-maverick`   | Cost-effective, open source       | Low           |

**Example — switching to Claude Sonnet:**

```typescript
const llm = getOpenRouterChatModel({
  model: 'anthropic/claude-sonnet-4',
  __includeRawResponse: true,
  modelKwargs: {
    require_parameters: true,
    include_reasoning: true,
  },
  reasoning: {
    effort: 'low',
  },
});
```

Browse all available models at [openrouter.ai/models](https://openrouter.ai/models).

> **Tip:** Start with a cheaper model during development, then switch to a more capable one for production.

---

## 03.4 — Quick Wins: Three Oracle Examples

Here are three ready-to-use configurations. For each, set the `APP_NAME` in `main-agent.ts` and update the prompt opening line in `prompt.ts`.

### Example A: Customer Support Oracle

**Use case:** A 24/7 support agent for an online platform.

**`APP_NAME` in `main-agent.ts`:**

```typescript
APP_NAME: 'HelpDesk Pro',
```

**Prompt opening line in `prompt.ts`:**

```
You are a patient and helpful customer support specialist for {{APP_NAME}}. Your top priority is resolving the user's issue quickly. Be empathetic, ask clarifying questions when the problem is unclear, and always confirm the resolution before closing the conversation.
```

---

### Example B: Research Assistant Oracle

**Use case:** A research companion that helps find, summarize, and organize information.

**`APP_NAME` in `main-agent.ts`:**

```typescript
APP_NAME: 'ResearchBuddy',
```

**Prompt opening line in `prompt.ts`:**

```
You are a meticulous research assistant powered by {{APP_NAME}}. You help users find, verify, and synthesize information. Always cite your sources, flag uncertainty, and present findings in a clear, structured format. When summarizing, distinguish between facts and interpretations.
```

---

### Example C: Domain-Specific Expert Oracle

**Use case:** A carbon credit advisor for project developers.

**`APP_NAME` in `main-agent.ts`:**

```typescript
APP_NAME: 'CarbonAdvisor',
```

**Prompt opening line in `prompt.ts`:**

```
You are a carbon markets specialist powered by {{APP_NAME}}. You help project developers navigate the complex world of carbon credit verification. Use precise terminology from Verra and Gold Standard frameworks, but explain concepts in plain language when the user is new to carbon markets. Always reference the specific standard or methodology when giving advice.
```

---

## Checklist

Before moving on, confirm you have:

- [ ] Set your oracle's name (`APP_NAME`) in `apps/app/src/graph/agents/main-agent.ts`
- [ ] Customized the prompt opening line in `apps/app/src/graph/nodes/chat-node/prompt.ts`
- [ ] Chosen your LLM model in `apps/app/src/graph/agents/main-agent.ts`
- [ ] Restarted the oracle to pick up changes

---

## Next Steps

- **[04 — Working with Skills](./04-working-with-skills.md)** — teach your oracle new capabilities from the skills registry
- **[Environment Variables Reference](./reference/environment-variables.md)** — full list of configuration options
- **[State Schema Reference](./reference/state-schema.md)** — all fields available in the graph state
