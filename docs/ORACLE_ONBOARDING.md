# Oracle onboarding for non-technical users

This guide helps you start your oracle, align it with your goal and skills, run it locally, test the messages API, and deploy.

---

## Step 1 – Init the project and set your API key

1. **Install the IXO Oracles CLI** (if you haven’t already):
   ```bash
   npm install -g ixo-oracles-cli
   ```

2. **Initialize your oracle project**:
   ```bash
   oracles-cli --init
   ```
   Follow the CLI prompts. It will set up environment variables and project structure.

3. **Set your Open Router API key**  
   The main AI model uses Open Router. Add this to your `.env` file in `apps/app/` (or wherever the app reads env):
   ```bash
   OPEN_ROUTER_API_KEY=your_key_here
   ```
   Get a key at [Open Router](https://openrouter.ai/) if needed.

---

## Step 2 – Align Cursor with your oracle (goal and skills)

1. Open this project in **Cursor**.

2. In the chat, say something like:
   - “Set up my oracle”
   - “Configure my oracle’s goal and skills”
   - “I want to align the AI with my oracle”

3. Cursor will:
   - Fetch the list of available skills from the IXO skills API
   - Ask you for your **oracle goal** (one short sentence, e.g. “Help my team create professional reports and presentations”)
   - Ask which **skills** to prioritize, or suggest some from the list (e.g. docx, pptx, xlsx)
   - Write your goal and skill names to `apps/app/oracle-config.json`
   - Ensure the main agent prompt uses this config so the AI behaves according to your goal and skills

4. If you change your goal or skills later, tell Cursor and it will update `oracle-config.json` again. Restart the app to pick up changes.

---

## Step 3 – Run the project locally

1. **Install dependencies and build** (from the repo root):
   ```bash
   pnpm install
   pnpm build
   ```

2. **Start the app**:
   ```bash
   cd apps/app
   pnpm start:dev
   ```

3. **Check your `.env`**  
   Make sure all required variables are set (Matrix base URL, Oracle DID, etc.) as described in the main [README](../README.md) and in `apps/app/.env.example` if present.

4. The API will listen on the port shown in the console (e.g. `http://localhost:3000`).

---

## Step 4 – Test the messages API

To call the messages API you need a **Matrix OpenID token** and then use it in the `x-matrix-access-token` header.

### 4.1 Generate a test token

Use the provided script so you only need your Matrix **username** and **password** (your IXO/Matrix account):

1. From the repo root, provide your Matrix **base URL**, **username**, and **password** via environment variables or arguments, then run:
   ```bash
   MATRIX_BASE_URL=https://matrix.ixo.earth MATRIX_USERNAME='@your-user:matrix.ixo.earth' MATRIX_PASSWORD=yourpassword pnpm run token
   ```
   Or pass them as arguments:
   ```bash
   pnpm run token -- https://matrix.ixo.earth '@your-user:matrix.ixo.earth' yourpassword
   ```
   You can also use `pnpm exec tsx scripts/get-openid-token.ts` with the same env or args.
   Use your Matrix user ID as username (e.g. `@did-ixo-ixo1...:matrix.ixo.earth`).

2. The script prints an **OpenID token** (a long string). Copy it; you’ll use it as `x-matrix-access-token`.

**How it works under the hood**: The script uses `login(baseUrl, username, password)` from `packages/matrix/src/utils/login.ts` to get a Matrix access token, then calls the same OpenID flow as `getOpenIdToken` in `packages/oracles-client-sdk/src/hooks/use-get-openid-token/get-openid-token.ts` (with `userId` = Matrix `user_id` from login, `matrixAccessToken` = that access token, and `did` derived from your user ID). The API expects this OpenID token, not the raw Matrix access token.

### 4.2 Get or create a session

- **List sessions** (to get an existing `sessionId`):
  ```bash
  curl -s -H "x-matrix-access-token: YOUR_OPENID_TOKEN" \
    "http://localhost:3000/sessions?limit=20&offset=0"
  ```

- **Create a new session** (if you don’t have one):
  ```bash
  curl -s -X POST -H "x-matrix-access-token: YOUR_OPENID_TOKEN" \
    -H "Content-Type: application/json" \
    "http://localhost:3000/sessions"
  ```
  Use the `sessionId` (or equivalent) from the response.

### 4.3 Send a message

Replace `YOUR_OPENID_TOKEN` and `SESSION_ID` with your token and session ID:

```bash
curl -s -X POST \
  -H "x-matrix-access-token: YOUR_OPENID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, can you help me create a short document?", "stream": false}' \
  "http://localhost:3000/messages/SESSION_ID"
```

For streaming responses, use `"stream": true` and read the SSE stream. The messages API is implemented in `apps/app/src/messages/messages.service.ts`; the controller is in `apps/app/src/messages/messages.controller.ts`.

---

## Step 5 – Deploy

When you’re ready to deploy:

1. Use the same run commands as locally: install, build, and start the app (e.g. `pnpm install`, `pnpm build`, then start the Nest app in `apps/app`).
2. Set all required environment variables in your deployment (including `OPEN_ROUTER_API_KEY`, Matrix base URL, Oracle DID, etc.) as in the main [README](../README.md) and deployment documentation.
3. The first user interaction should go through the **web portal** so users can grant AuthZ and subscriptions; after that, Matrix and Slack clients can connect as described in the README.

---

## Summary

| Step | What you do |
|------|-------------|
| 1 | Run `oracles-cli --init`, set `OPEN_ROUTER_API_KEY` in `.env` |
| 2 | In Cursor, ask to “set up my oracle” so it fetches skills and updates `oracle-config.json` and the main agent prompt |
| 3 | `pnpm install`, `pnpm build`, `cd apps/app && pnpm start:dev` |
| 4 | Run `scripts/get-openid-token.ts` to get a token, then call `POST /messages/:sessionId` with header `x-matrix-access-token` |
| 5 | Deploy with the same env and run commands as locally |
