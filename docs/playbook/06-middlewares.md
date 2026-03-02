# 06 — Middlewares

## 06.1 — What are middlewares?

Code that runs before or after every tool call — for safety, validation, and billing.

Think of middlewares as checkpoints. Every time your oracle calls a tool or responds to a user, the request passes through each middleware in order. Any middleware can modify, retry, or block the request.

---

## 06.2 — Built-in middlewares

Your oracle ships with four middlewares already wired up:

| Middleware           | What it does                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Tool Validation**  | Catches invalid tool inputs and returns helpful errors so the AI can self-correct                            |
| **Tool Retry**       | Retries tool calls that fail due to temporary issues (network blips, timeouts)                               |
| **Safety Guardrail** | Evaluates responses for unsafe content — blocks leaked secrets, PII, and harmful output                      |
| **Token Limiter**    | Checks the user's remaining credits before each call and deducts after — disable with `DISABLE_CREDITS=true` |

---

## 06.3 — Writing a custom middleware

Here is a logging middleware you can copy-paste. It prints every tool call to the console:

```typescript
// apps/app/src/graph/middlewares/logging-middleware.ts

import { createMiddleware, type AgentMiddleware } from 'langchain';

export const createLoggingMiddleware = (): AgentMiddleware => {
  return createMiddleware({
    name: 'LoggingMiddleware',
    wrapToolCall: async (toolCallRequest, handler) => {
      console.log(`Tool called: ${toolCallRequest.tool.name}`);
      const result = await handler(toolCallRequest);
      console.log(`Tool result received`);
      return result;
    },
  });
};
```

### Available hooks

You can use any combination of these hooks inside `createMiddleware`:

| Hook           | When it runs            | Use it to...                                    |
| -------------- | ----------------------- | ----------------------------------------------- |
| `beforeModel`  | Before the LLM call     | Modify state, block requests, check permissions |
| `afterModel`   | After the LLM responds  | Post-process output, track usage                |
| `afterAgent`   | After a full agent turn | Run final checks, evaluate safety               |
| `wrapToolCall` | Around each tool call   | Catch errors, add retries, log calls            |

---

## 06.4 — Adding it to your oracle

Open `apps/app/src/graph/agents/main-agent.ts` and add your middleware to the array:

```typescript
const middleware = [
  createToolValidationMiddleware(),
  toolRetryMiddleware(),
  createSafetyGuardrailMiddleware(),
  createTokenLimiterMiddleware(),
  createLoggingMiddleware(), // ← add your middleware here
];
```

That's it. Your middleware will run on every tool call from now on. Order matters — middlewares execute top to bottom.
