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
SYNC_TASKS="${DEV_FACTORY_SYNC_TASKS:-true}"
USE_NIGHT_BRANCH="${DEV_FACTORY_USE_NIGHT_BRANCH:-true}"
BASE_BRANCH="${DEV_FACTORY_BASE_BRANCH:-main}"
BRANCH_PREFIX="${DEV_FACTORY_BRANCH_PREFIX:-nightly}"
RUN_UNTIL_MORNING="${DEV_FACTORY_RUN_UNTIL_MORNING:-false}"
RUN_UNTIL_LOCAL_HHMM="${DEV_FACTORY_RUN_UNTIL_LOCAL_HHMM:-08:00}"
RUN_UNTIL_TZ="${DEV_FACTORY_RUN_UNTIL_TZ:-UTC}"

if [ ! -d "$DIR" ]; then
  echo "ERROR: Project directory not found: $DIR"
  exit 1
fi

cd "$DIR"

echo "Dev Factory V2 - Starting Night Session"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: $DIR is not a git repository"
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Already running. Attach: tmux attach -t $SESSION"
  exit 1
fi

if [ "${DEV_FACTORY_VALIDATE_SCOPE:-true}" = "true" ]; then
  echo "Validating backlog scope against VC product flow"
  bash "$DIR/scripts/validate_backlog_scope.sh" "$DIR/docs/REVISION_BACKLOG.md"
fi

if [ ! -f "$DIR/tasks.md" ]; then
  echo "No tasks.md found in $DIR. Generating from backlog..."
  bash "$DIR/scripts/sync_tasks_from_backlog.sh"
fi

if [ "$SYNC_TASKS" = "true" ]; then
  echo "DEV_FACTORY_SYNC_TASKS=true -> regenerating tasks.md from backlog"
  bash "$DIR/scripts/sync_tasks_from_backlog.sh"
fi

if [ "$USE_NIGHT_BRANCH" = "true" ]; then
  current_branch="$(git branch --show-current)"
  if [ "$current_branch" = "$BASE_BRANCH" ]; then
    branch_name="$BRANCH_PREFIX/$(date +%Y%m%d_%H%M%S)"
    if ! git checkout -b "$branch_name" >/dev/null 2>&1; then
      branch_name="${branch_name}_$RANDOM"
      git checkout -b "$branch_name" >/dev/null 2>&1
    fi
    echo "Working branch: $branch_name"
  else
    echo "Current branch: $current_branch (keeping current branch for night run)"
  fi
else
  echo "Night branch mode disabled (DEV_FACTORY_USE_NIGHT_BRANCH=false)"
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
if [ "$RUN_UNTIL_MORNING" = "true" ]; then
  echo "Mode: run-until-morning enabled (${RUN_UNTIL_LOCAL_HHMM} ${RUN_UNTIL_TZ})"
else
  echo "Mode: single-wave (set DEV_FACTORY_RUN_UNTIL_MORNING=true for all-night mode)"
fi
echo ""
echo "Starting in 3 seconds... (Ctrl+C to cancel)"
sleep 3

RUN_LOG="$DIR/logs/night_$(date +%Y%m%d_%H%M).log"

tmux new-session -d -s "$SESSION" -c "$DIR" \
  "DEV_FACTORY_LOG_FILE=$RUN_LOG bash $DIR/scripts/run_night.sh $DIR/tasks.md"

echo "Night run started."
echo "Branch: $(git branch --show-current)"
echo "Log:    $RUN_LOG"
echo "Watch:  tmux attach -t $SESSION"
echo "Stop:   tmux kill-session -t $SESSION"
echo "Report: logs/reports/night-shift-report.md"
echo "Scope:  VC product backlog guard active"
