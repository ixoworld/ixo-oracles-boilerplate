# Guide: Payments & Claims — @ixo/oracles-chain-client

> **What you'll build:** Token-based pricing, credit management, claim submission, and escrow payments for your oracle.

---

## How Pricing Works

<!-- TODO: Set during entity creation via CLI, price in IXO Credits -->

---

## Token Limiter Middleware

<!-- TODO: beforeModel checks balance, afterModel deducts. LLM tokens → credits conversion -->

- `beforeModel` — checks the user's remaining credit balance, blocks if ≤ 0
- `afterModel` — deducts credits based on actual token usage
- Disable with `DISABLE_CREDITS=true` for free/development oracles

---

## Claims

<!-- TODO: claimsClient.submitClaim(), claim intents, collection management -->

---

## Payments

<!-- TODO: Escrow-based via walletClient -->

---

## AuthZ Permissions

<!-- TODO: authzClient for permission grants -->

---

## Client-Side Integration

<!-- TODO: useContractOracle hook → contractOracle() for auth, payClaim() for payment -->

---

## ECIES Encryption

<!-- TODO: Encryption utilities for sensitive data -->

**Source:** `packages/oracles-chain-client/`
