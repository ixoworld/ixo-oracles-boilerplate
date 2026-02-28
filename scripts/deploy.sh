#!/usr/bin/env bash
# Usage: ./scripts/deploy.sh [path-to-env-file]
# Full deploy: ensure volume exists, set secrets, deploy to Fly.io.

set -e

ENV_FILE="${1:-apps/app/.env}"
VOLUME_NAME="oracle_data_2"
REGION="ams"

# Storage paths — override to use the mounted volume at /data
# Locally these are relative (./matrix-storage, ./checkpoints)
# In production they must point to the persistent volume
MATRIX_STORE_PATH="/data/matrix-storage"
MATRIX_CRYPTO_STORE_PATH="/data/matrix-storage"
MATRIX_SECRET_STORAGE_KEYS_PATH="/data/matrix-secret-storage-keys"
SQLITE_DATABASE_PATH="/data/checkpoints"

# 1. Ensure single machine
echo "Scaling to 1 machine..."
fly scale count 1 --yes 2>/dev/null || true

# 2. Check/create volume
echo "Checking for volume '$VOLUME_NAME'..."
VOLUME_COUNT=$(fly volumes list --json 2>/dev/null | grep -c "\"$VOLUME_NAME\"" || true)

if [ "$VOLUME_COUNT" -eq 0 ]; then
  echo "No volume found. Creating '$VOLUME_NAME' in $REGION..."
  fly volumes create "$VOLUME_NAME" --region "$REGION" --size 1 --count 1 -y
  echo "Volume created."
else
  echo "Volume '$VOLUME_NAME' already exists ($VOLUME_COUNT found). Skipping."
fi

# 3. Set secrets from .env
echo ""
./scripts/fly-secrets.sh "$ENV_FILE"

# 4. Override storage paths to use the mounted volume
echo ""
echo "Setting storage paths to /data volume..."
fly secrets set --stage \
  MATRIX_STORE_PATH="$MATRIX_STORE_PATH" \
  MATRIX_CRYPTO_STORE_PATH="$MATRIX_CRYPTO_STORE_PATH" \
  MATRIX_SECRET_STORAGE_KEYS_PATH="$MATRIX_SECRET_STORAGE_KEYS_PATH" \
  SQLITE_DATABASE_PATH="$SQLITE_DATABASE_PATH"
echo "Storage paths set."

# 5. Deploy
echo ""
echo "Deploying to Fly.io..."
fly deploy
