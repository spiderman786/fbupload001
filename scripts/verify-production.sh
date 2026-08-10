#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://app.fbuploadplus.com}"
EXPECTED_COMMIT="${2:-}"

echo "Checking ${BASE_URL}/api/health ..."
health=$(curl -fsS "${BASE_URL}/api/health")
echo "$health" | python3 -m json.tool

role=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processRole',''))")
commit=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('gitCommit') or '')")

if [[ "$role" != "web" ]]; then
  echo "WARN: processRole is '$role' (expected web on public URL)"
fi

if [[ -n "$EXPECTED_COMMIT" && "$commit" != "$EXPECTED_COMMIT" ]]; then
  echo "FAIL: gitCommit=$commit expected $EXPECTED_COMMIT (deploy may still be rolling out)"
  exit 1
fi

echo "Checking live snapshot ..."
curl -fsS "${BASE_URL}/api/public/live-snapshot" | python3 -m json.tool | head -20

echo "OK"
