#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://127.0.0.1:3000}

curl -sf "$BASE_URL/health" >/dev/null
curl -sf "$BASE_URL/metrics" >/dev/null
curl -sf "$BASE_URL/queue" >/dev/null

echo "healthcheck ok"
