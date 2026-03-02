#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [ -f /root/.dev_factory_exports ]; then
  # shellcheck disable=SC1091
  source /root/.dev_factory_exports
fi

fail=0
check() {
  local name="$1"
  local cmd="$2"
  if bash -lc "$cmd" >/dev/null 2>&1; then
    echo "[OK] $name"
  else
    echo "[FAIL] $name"
    fail=1
  fi
}

echo "VCReach System Health Check"
check "git repo" "git rev-parse --git-dir"
check "node installed" "command -v node"
check "npm installed" "command -v npm"
check "aider installed" "command -v aider"
check "tmux installed" "command -v tmux"
check "OPENROUTER_API_KEY set" "test -n \"${OPENROUTER_API_KEY:-}\""
check "typecheck" "npm run typecheck"
check "tests" "npm test"

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "All checks passed."
