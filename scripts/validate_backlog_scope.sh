#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKLOG_FILE="${1:-$PROJECT_DIR/docs/REVISION_BACKLOG.md}"
MAX_TASKS="${MAX_NIGHTLY_TASKS:-3}"
STRICT_MODE="${DEV_FACTORY_SCOPE_GUARD_STRICT:-true}"

REQUIRED_REGEX="${DEV_FACTORY_SCOPE_REQUIRED_REGEX:-submission|approval|workflow|orchestrator|import|research|queue|dashboard|evidence|workspace|firm|campaign|watchdog|retry|recovery|operator}"
BLOCKED_REGEX="${DEV_FACTORY_SCOPE_BLOCKED_REGEX:-middleware|rate[ -]?limit|dev[ -]?factory|aider|tmux|ci quality gate|night run script hardening}"

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "ERROR: backlog file not found: $BACKLOG_FILE"
  exit 1
fi

lines="$(grep -E '^- \[ \] P[0-3] \|' "$BACKLOG_FILE" | head -n "$MAX_TASKS" || true)"
if [ -z "$lines" ]; then
  echo "ERROR: no open backlog items found in $BACKLOG_FILE"
  exit 1
fi

errors=0
index=0

echo "Backlog scope guard: checking top $MAX_TASKS open tasks..."

while IFS= read -r line; do
  [ -n "$line" ] || continue
  index=$((index + 1))

  payload="$(printf '%s' "$line" | sed -E 's/^- \[ \] //')"
  title="$(printf '%s' "$payload" | cut -d'|' -f2 | xargs)"
  details="$(printf '%s' "$payload" | cut -d'|' -f3 | xargs)"
  acceptance="$(printf '%s' "$payload" | cut -d'|' -f4- | xargs)"

  merged="$(printf '%s %s %s' "$title" "$details" "$acceptance" | tr '[:upper:]' '[:lower:]')"

  if ! printf '%s' "$merged" | grep -Eq "$REQUIRED_REGEX"; then
    echo "[FAIL] Task $index is out of VC product scope (missing required domain terms): $title"
    errors=$((errors + 1))
  else
    echo "[OK]   Task $index scope match: $title"
  fi

  if [ "$STRICT_MODE" = "true" ] && printf '%s' "$merged" | grep -Eq "$BLOCKED_REGEX"; then
    echo "[FAIL] Task $index looks like infra/system drift in strict mode: $title"
    errors=$((errors + 1))
  fi
done <<< "$lines"

if [ "$errors" -gt 0 ]; then
  echo "Backlog scope guard failed with $errors issue(s)."
  exit 1
fi

echo "Backlog scope guard passed."
