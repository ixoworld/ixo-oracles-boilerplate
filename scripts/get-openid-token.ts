#!/usr/bin/env node
/**
 * Generate a Matrix OpenID token for testing the messages API.
 * Use this token in the x-matrix-access-token header when calling
 * POST /messages/:sessionId and other authenticated endpoints.
 *
 * Usage:
 *   pnpm exec tsx scripts/get-openid-token.ts
 *   MATRIX_BASE_URL=https://matrix.ixo.earth MATRIX_USERNAME=@user:server MATRIX_PASSWORD=secret pnpm exec tsx scripts/get-openid-token.ts
 *   pnpm exec tsx scripts/get-openid-token.ts https://matrix.ixo.earth myuser mypassword
 *
 * Requires: MATRIX_BASE_URL (or first arg), username (env MATRIX_USERNAME or second arg), password (env MATRIX_PASSWORD or third arg).
 */

const baseUrl =
  process.argv[2] ?? process.env.MATRIX_BASE_URL ?? '';
const username =
  process.argv[3] ?? process.env.MATRIX_USERNAME ?? '';
const password =
  process.argv[4] ?? process.env.MATRIX_PASSWORD ?? '';

if (!baseUrl || !username || !password) {
  console.error('Usage: get-openid-token.ts [MATRIX_BASE_URL] [username] [password]');
  console.error('   or set MATRIX_BASE_URL, MATRIX_USERNAME, MATRIX_PASSWORD');
  process.exit(1);
}

const base = baseUrl.replace(/\/$/, '');

async function main() {
  // 1) Matrix login (password)
  const loginRes = await fetch(`${base}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      user: username,
      password,
    }),
  });

  if (!loginRes.ok) {
    const text = await loginRes.text();
    throw new Error(`Login failed: ${loginRes.status} ${text}`);
  }

  const loginJson = (await loginRes.json()) as {
    access_token?: string;
    user_id?: string;
  };

  const accessToken = loginJson.access_token;
  const userId = loginJson.user_id;

  if (!accessToken || !userId) {
    throw new Error('Login response missing access_token or user_id');
  }

  // 2) Request OpenID token
  const openIdRes = await fetch(
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  );

  if (!openIdRes.ok) {
    const text = await openIdRes.text();
    throw new Error(`OpenID request failed: ${openIdRes.status} ${text}`);
  }

  const openIdJson = (await openIdRes.json()) as { access_token?: string };
  const openIdToken = openIdJson.access_token;

  if (!openIdToken) {
    throw new Error('OpenID response missing access_token');
  }

  console.log('Use this token in the x-matrix-access-token header:\n');
  console.log(openIdToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
