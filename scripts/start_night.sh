#!/bin/bash
set -euo pipefail

if [ -f /root/.dev_factory_exports ]; then
  # shellcheck disable=SC1091
  source /root/.dev_factory_exports
else
  set +u
  # shellcheck disable=SC1091
  source ~/.bashrc 2>/dev/null || true
  set -u
fi

SESSION="devfactory"
DIR="${DEV_FACTORY_DIR:-$HOME/project}"

if [ ! -d "$DIR" ]; then
  echo "ERROR: Project directory not found: $DIR"
  exit 1
fi

cd "$DIR"

echo "Dev Factory V2 - Starting Night Session"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Already running. Attach: tmux attach -t $SESSION"
  exit 1
fi

if [ ! -f "$DIR/tasks.md" ]; then
  echo "No tasks.md found in $DIR. Generating from backlog..."
  bash "$DIR/scripts/sync_tasks_from_backlog.sh"
fi

if [ "${DEV_FACTORY_SYNC_TASKS:-false}" = "true" ]; then
  echo "DEV_FACTORY_SYNC_TASKS=true -> regenerating tasks.md from backlog"
  bash "$DIR/scripts/sync_tasks_from_backlog.sh"
fi

TASK_COUNT=$(grep -c '^## Task' "$DIR/tasks.md" 2>/dev/null || echo 0)
if [ "$TASK_COUNT" -eq 0 ]; then
  echo "No tasks in tasks.md - write tasks first"
  exit 1
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "OPENROUTER_API_KEY missing. Run: source /root/.dev_factory_exports"
  exit 1
fi

mkdir -p "$DIR/logs"

echo "Tasks found: $TASK_COUNT"
grep '^## Task' "$DIR/tasks.md" | sed 's/^## /  - /'
echo ""
echo "Starting in 3 seconds... (Ctrl+C to cancel)"
sleep 3

tmux new-session -d -s "$SESSION" -c "$DIR" \
  "bash $DIR/scripts/run_night.sh $DIR/tasks.md 2>&1 | tee -a $DIR/logs/night_$(date +%Y%m%d_%H%M).log; echo ''; echo 'Done. Press Enter.'; read"

echo "Night run started."
echo "Watch:  tmux attach -t $SESSION"
echo "Stop:   tmux kill-session -t $SESSION"
