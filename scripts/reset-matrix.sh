#!/usr/bin/env bash
# Usage: ./scripts/reset-matrix.sh [path-to-env-file]
# Resets a stale Matrix token by wiping the volume (crypto store) and
# obtaining a fresh access token via the Matrix login API.
#
# When to use: oracle fails on startup with Matrix auth/crypto errors
# because the token or device changed but the on-disk store is stale.

set -e

ENV_FILE="${1:-apps/app/.env}"
VOLUME_NAME="oracle_data_2"
REGION="ams"

# Storage paths — must match deploy.sh
MATRIX_STORE_PATH="/data/matrix-storage"
MATRIX_CRYPTO_STORE_PATH="/data/matrix-storage"
MATRIX_SECRET_STORAGE_KEYS_PATH="/data/matrix-secret-storage-keys"
SQLITE_DATABASE_PATH="/data/checkpoints"

# --- Read .env ---
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

read_env() {
  local key="$1"
  local value
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2-)
  # Strip surrounding quotes
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  echo "$value"
}

MATRIX_BASE_URL=$(read_env "MATRIX_BASE_URL")
MATRIX_USER_ID=$(read_env "MATRIX_ORACLE_ADMIN_USER_ID")
MATRIX_PASSWORD=$(read_env "MATRIX_ORACLE_ADMIN_PASSWORD")

# Strip trailing slash to avoid double-slash in URLs
MATRIX_BASE_URL="${MATRIX_BASE_URL%/}"

if [ -z "$MATRIX_BASE_URL" ] || [ -z "$MATRIX_USER_ID" ] || [ -z "$MATRIX_PASSWORD" ]; then
  echo "Error: Missing MATRIX_BASE_URL, MATRIX_ORACLE_ADMIN_USER_ID, or MATRIX_ORACLE_ADMIN_PASSWORD in $ENV_FILE"
  exit 1
fi

echo "=== Matrix Token Reset ==="
echo "Using env file: $ENV_FILE"
echo "Matrix server:  $MATRIX_BASE_URL"
echo "Matrix user:    $MATRIX_USER_ID"
echo ""

# --- Step 1: Destroy machine (must unbind volume before deleting it) ---
echo "[1/6] Destroying machine..."
MACHINE_ID=$(fly machines list --json | jq -r '.[0].id')
if [ -z "$MACHINE_ID" ] || [ "$MACHINE_ID" = "null" ]; then
  echo "  No machine found, skipping."
else
  fly machine stop "$MACHINE_ID"
  fly machine destroy "$MACHINE_ID" --force
  echo "  Destroyed $MACHINE_ID"
fi

# --- Step 2: Delete volume (wipes /data including crypto store) ---
echo ""
echo "[2/6] Deleting volume (wipes crypto store)..."
VOLUME_ID=$(fly volumes list --json | jq -r '.[0].id')
if [ -z "$VOLUME_ID" ] || [ "$VOLUME_ID" = "null" ]; then
  echo "  No volume found, skipping."
else
  fly volumes delete "$VOLUME_ID" -y
  echo "  Deleted volume $VOLUME_ID"
fi

# --- Step 3: Get fresh Matrix access token ---
echo ""
echo "[3/6] Logging into Matrix to get fresh token..."
LOGIN_RESPONSE=$(curl -s -X POST "${MATRIX_BASE_URL}/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"'"$MATRIX_USER_ID"'","password":"'"$MATRIX_PASSWORD"'"}')

NEW_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token')

if [ -z "$NEW_TOKEN" ] || [ "$NEW_TOKEN" = "null" ]; then
  echo "  Error: Matrix login failed."
  echo "  Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "  Got new token: ${NEW_TOKEN:0:10}..."

# --- Step 4: Set new token as Fly secret ---
echo ""
echo "[4/6] Setting new token as Fly secret..."
fly secrets set --stage MATRIX_ORACLE_ADMIN_ACCESS_TOKEN="$NEW_TOKEN"
echo "  Token staged."

# --- Step 5: Create fresh volume ---
echo ""
echo "[5/6] Creating fresh volume '$VOLUME_NAME' in $REGION..."
fly volumes create "$VOLUME_NAME" --region "$REGION" --size 1 --count 1 -y
echo "  Volume created."

# --- Step 6: Set storage paths and deploy ---
echo ""
echo "[6/6] Setting storage paths and deploying..."
fly secrets set --stage \
  MATRIX_STORE_PATH="$MATRIX_STORE_PATH" \
  MATRIX_CRYPTO_STORE_PATH="$MATRIX_CRYPTO_STORE_PATH" \
  MATRIX_SECRET_STORAGE_KEYS_PATH="$MATRIX_SECRET_STORAGE_KEYS_PATH" \
  SQLITE_DATABASE_PATH="$SQLITE_DATABASE_PATH"

fly deploy
echo ""
echo "=== Done! Oracle deployed with fresh Matrix token and clean storage ==="
echo "Run 'fly logs' to verify Matrix login succeeds."
