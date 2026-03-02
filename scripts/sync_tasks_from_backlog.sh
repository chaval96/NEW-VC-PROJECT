#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKLOG_FILE="${1:-$PROJECT_DIR/docs/REVISION_BACKLOG.md}"
OUTPUT_FILE="${2:-$PROJECT_DIR/tasks.md}"
MAX_TASKS="${MAX_NIGHTLY_TASKS:-3}"

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "ERROR: backlog file not found: $BACKLOG_FILE"
  exit 1
fi

lines="$(grep -E '^- \[ \] P[0-3] \|' "$BACKLOG_FILE" | head -n "$MAX_TASKS" || true)"
if [ -z "$lines" ]; then
  echo "ERROR: no open backlog items found in $BACKLOG_FILE"
  exit 1
fi

cat > "$OUTPUT_FILE" <<'TASKS'
# Night Run Tasks

## GLOBAL RULES
- This is a TypeScript project with Express backend and Vite React frontend.
- Files in tests/acceptance/ are READ-ONLY. Never modify them.
- If an acceptance test fails, fix the CODE not the test.
- Use behavioral assertions (avoid brittle exact timestamps/UUIDs).
- Keep functions focused and changes minimal.
TASKS

idx=1
while IFS= read -r line; do
  [ -n "$line" ] || continue
  payload="$(printf '%s' "$line" | sed -E 's/^- \[ \] //')"

  priority="$(printf '%s' "$payload" | cut -d'|' -f1 | xargs)"
  title="$(printf '%s' "$payload" | cut -d'|' -f2 | xargs)"
  details="$(printf '%s' "$payload" | cut -d'|' -f3 | xargs)"
  acceptance="$(printf '%s' "$payload" | cut -d'|' -f4- | xargs)"

  {
    echo
    echo "## Task ${idx}: ${title}"
    echo "Priority: ${priority}"
    echo "- ${details}"
    echo "- Acceptance: ${acceptance}"
  } >> "$OUTPUT_FILE"

  idx=$((idx + 1))
done <<< "$lines"

echo "Generated $(($idx - 1)) tasks into $OUTPUT_FILE"
