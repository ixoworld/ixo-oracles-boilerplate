# CLAUDE.md - @ixo/oracles-chain-client

## Important: No @ixo/logger in browser-reachable code

Do NOT use `@ixo/logger` in any file that is exported via the `react` entrypoint (`src/react/index.ts`). The `@ixo/logger` package uses Winston and `node:util`, which are Node.js-only. Since `@ixo/oracles-client-sdk` imports from `@ixo/oracles-chain-client/react` and runs in the browser, any `@ixo/logger` import in the chain will cause Webpack build failures in frontend apps.

Use `console.log`, `console.warn`, `console.error` instead for any code reachable from the `react` entrypoint.

`@ixo/logger` is fine in server-only code (e.g., `matrix-bot/` files not exported via `react`).
