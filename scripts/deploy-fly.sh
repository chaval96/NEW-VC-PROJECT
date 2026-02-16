#!/usr/bin/env bash
set -euo pipefail

if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl not found. Install from https://fly.io/docs/flyctl/install/"
  exit 1
fi

if [ ! -f .env.production ]; then
  echo ".env.production not found. Create it first from .env.example"
  exit 1
fi

set -a
source .env.production
set +a

flyctl secrets set \
  NODE_ENV="${NODE_ENV:-production}" \
  PORT="${PORT:-8787}" \
  DATABASE_URL="${DATABASE_URL}" \
  DATABASE_SSL="${DATABASE_SSL:-require}" \
  CORS_ORIGIN="${CORS_ORIGIN:-*}"

flyctl deploy
