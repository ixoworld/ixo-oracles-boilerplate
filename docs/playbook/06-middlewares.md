# 06 — Middlewares: Guard and Control

> **What you'll build:** Custom middleware to intercept, validate, and transform messages at each stage of the agent pipeline.

---

## Middleware Hooks

<!-- TODO: Explain each hook with when it fires and what it can do -->

| Hook           | When                  | Purpose                                         |
| -------------- | --------------------- | ----------------------------------------------- |
| `beforeModel`  | Before LLM call       | Modify state, block requests, check permissions |
| `afterModel`   | After LLM response    | Post-process, track usage, modify output        |
| `afterAgent`   | After full agent turn | Final checks, safety evaluation                 |
| `wrapToolCall` | Around each tool call | Catch errors, add retries, log calls            |

---

## Tool Validation Middleware

<!-- TODO: Show code from tool-validation-middleware.ts -->

`apps/app/src/graph/middlewares/tool-validation-middleware.ts` — catches Zod schema errors from tool calls and returns structured error messages, allowing the LLM to self-correct.

---

## Safety Guardrail Middleware

<!-- TODO: Show code from safety-guardrail-middleware.ts -->

`apps/app/src/graph/middlewares/safety-guardrail-middleware.ts` — uses `openai/gpt-oss-safeguard-20b:nitro` to evaluate responses. Runs in the `afterAgent` hook.

**Blocks:** actual API keys, tokens, passwords, security exploits, PII leaks, harmful content.

**Allows:** feature explanations, how-to instructions, system capabilities, AWS pre-signed URLs.

---

## Token Limiter Middleware

<!-- TODO: Show code from token-limiter-middleware.ts -->

`apps/app/src/graph/middlewares/token-limiter-middleware.ts`:

- `beforeModel` — checks user's remaining credit balance, blocks if ≤ 0
- `afterModel` — deducts credits based on token usage

Disabled when `DISABLE_CREDITS=true`.

---

## Execution Order

The middleware array order matters:

```typescript
const middleware = [
  createToolValidationMiddleware(), // Catch tool errors
  toolRetryMiddleware(), // Retry transient failures
  createSafetyGuardrailMiddleware(), // Check response safety
  createTokenLimiterMiddleware(), // Deduct credits (if enabled)
];
```

---

## Custom Middleware Example

<!-- TODO: Build a practical example (e.g., logging middleware, rate limiting, content filtering) -->
