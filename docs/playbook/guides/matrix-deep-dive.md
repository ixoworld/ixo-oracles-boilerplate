# Guide: Matrix Deep Dive — @ixo/matrix

> **What you'll learn:** How E2E encryption, room management, checkpoint sync, and authentication work under the hood.

---

## Singleton MatrixManager

<!-- TODO: getInstance(), init(), lifecycle -->

---

## E2E Encrypted Rooms

<!-- TODO: createRoomAndJoin() per user, encryption setup -->

---

## Messaging

<!-- TODO: sendMessage(), threading, message types -->

---

## State Management

<!-- TODO: stateManager.setState<T>(), getState<T>() -->

---

## Checkpoint Sync

<!-- TODO: SQLite → Matrix on shutdown, Matrix → SQLite on startup -->

---

## Security

<!-- TODO: x-matrix-access-token + x-did header validation -->

---

## Admin vs User Tokens

<!-- TODO: Admin sends messages, user only joins rooms -->

**Source:** `packages/matrix/`
