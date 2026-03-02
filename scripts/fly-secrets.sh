#!/usr/bin/env bash
# Usage: ./scripts/fly-secrets.sh [path-to-env-file]
# Reads a .env file and sets all variables as Fly.io secrets.

ENV_FILE="${1:-apps/app/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

echo "Setting secrets from $ENV_FILE..."

ARGS=()
while IFS= read -r line || [ -n "$line" ]; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  # Strip inline comments (only outside quotes)
  line="${line%%#*}"
  # Trim whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [ -z "$line" ] && continue

  # Extract key and value
  key="${line%%=*}"
  value="${line#*=}"
  # Strip surrounding quotes from value
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"

  [ -z "$key" ] && continue
  ARGS+=("${key}=${value}")
done < "$ENV_FILE"

if [ ${#ARGS[@]} -eq 0 ]; then
  echo "No secrets found in $ENV_FILE"
  exit 1
fi

echo "Setting ${#ARGS[@]} secrets..."
fly secrets set --stage "${ARGS[@]}"
echo "Done! All secrets set."
