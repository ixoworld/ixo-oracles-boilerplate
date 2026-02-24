# 03 — Customize Your Oracle: Give It a Personality

> **What you'll build:** An oracle with a distinct identity, purpose, and behavioral style tailored to your use case.

---

## The oracleConfig Object

The first thing to customize. Located in `apps/app/src/config.ts` (lines 1–10):

<!-- TODO: Show actual oracleConfig with before/after example -->

```typescript
export const oracleConfig = {
  appName: '', // Your oracle's name
  appPurpose: '', // What it does (1-2 sentences)
  appMainFeatures: '', // Key capabilities
  appTargetUsers: '', // Who it serves
  appUniqueSellingPoints: '', // What makes it special
};
```

These values are injected into the system prompt and shape the LLM's behavior.

---

## The System Prompt Template

Located in `apps/app/src/graph/nodes/chat-node/prompt.ts`.

<!-- TODO: Show simplified version of the prompt template with key sections annotated -->
<!-- TODO: List all InputVariables and where their values come from -->

### Input Variables

| Variable                       | Source                 | Description                                |
| ------------------------------ | ---------------------- | ------------------------------------------ |
| `APP_NAME`                     | `oracleConfig.appName` | Oracle display name                        |
| `IDENTITY_CONTEXT`             | Memory Agent           | User's identity info                       |
| `WORK_CONTEXT`                 | Memory Agent           | User's work context                        |
| `GOALS_CONTEXT`                | Memory Agent           | User's goals                               |
| `INTERESTS_CONTEXT`            | Memory Agent           | User's interests                           |
| `RELATIONSHIPS_CONTEXT`        | Memory Agent           | User's relationships                       |
| `RECENT_CONTEXT`               | Memory Agent           | Recent activity                            |
| `TIME_CONTEXT`                 | System                 | Current timestamp                          |
| `EDITOR_DOCUMENTATION`         | Conditional            | BlockNote editor docs (if editor active)   |
| `AG_UI_TOOLS_DOCUMENTATION`    | Conditional            | AG-UI component docs (if actions provided) |
| `CURRENT_ENTITY_DID`           | State                  | Active entity context                      |
| `SLACK_FORMATTING_CONSTRAINTS` | Conditional            | Slack-specific formatting rules            |

---

## How User Context Gets Populated

<!-- TODO: Explain the Memory Agent → userContext → prompt injection flow -->

The Memory Agent retrieves per-user context on each conversation and injects it into the prompt. This personalizes responses based on what the oracle knows about each user.

---

## Practical Walkthrough

<!-- TODO: Step-by-step example: customize for a customer support oracle -->
<!-- TODO: Show before/after of key prompt sections -->

---

## Conditional Sections

<!-- TODO: Explain editor mode, Slack mode, AG-UI mode -->

The prompt dynamically includes or excludes sections based on the client and state:

- **Editor mode** — adds BlockNote documentation when `editorRoomId` is set
- **Slack mode** — adds formatting constraints when `client === 'slack'`
- **AG-UI mode** — adds custom component documentation when `agActions` are provided

---

## LLM Model Selection

<!-- TODO: Show how to change the model in main-agent.ts -->

The default model is `openai/gpt-oss-120b:nitro` via OpenRouter. To change it, edit the `getOpenRouterChatModel()` call in `apps/app/src/graph/agents/main-agent.ts`.
