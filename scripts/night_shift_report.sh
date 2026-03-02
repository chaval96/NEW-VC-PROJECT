#!/bin/bash
set -euo pipefail

DIR="${DEV_FACTORY_DIR:-$HOME/project}"
cd "$DIR"

LOG_FILE="${1:-}"
if [ -z "$LOG_FILE" ]; then
  LOG_FILE="$(ls -1t logs/night_*.log 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$LOG_FILE" ] || [ ! -f "$LOG_FILE" ]; then
  echo "ERROR: log file not found" >&2
  exit 1
fi

if ! grep -q 'NIGHT RUN COMPLETE' "$LOG_FILE"; then
  echo "ERROR: run is not completed yet" >&2
  exit 2
fi

mkdir -p logs/reports

run_id="$(basename "$LOG_FILE" .log | sed 's/^night_//')"
out_file="logs/reports/night-shift-report_${run_id}.md"
latest_file="logs/reports/night-shift-report.md"

started_at="$(grep -m1 'DEV FACTORY V2 NIGHT RUN START' "$LOG_FILE" | sed -E 's/^\[([^]]+)\].*/\1/' || true)"
completed_at="$(grep -m1 'NIGHT RUN COMPLETE' "$LOG_FILE" | sed -E 's/^\[([^]]+)\].*/\1/' || true)"

project_line="$(grep -m1 'Project:' "$LOG_FILE" || true)"
tasks_file_line="$(grep -m1 'Tasks file:' "$LOG_FILE" || true)"
branch="$(git branch --show-current 2>/dev/null || true)"

summary_completed="$(grep -Eo 'Completed: [0-9]+' "$LOG_FILE" | tail -1 | awk '{print $2}' || true)"
summary_failed="$(grep -Eo 'Failed: [0-9]+' "$LOG_FILE" | tail -1 | awk '{print $2}' || true)"
summary_skipped="$(grep -Eo 'Skipped: [0-9]+' "$LOG_FILE" | tail -1 | awk '{print $2}' || true)"
duration_line="$(grep -E 'Duration \(minutes\):' "$LOG_FILE" | tail -1 || true)"
iterations_line="$(grep -E 'Total iterations:' "$LOG_FILE" | tail -1 || true)"
backlog_line="$(grep -E 'Backlog progress:' "$LOG_FILE" | tail -1 || true)"
stop_reason_line="$(grep -E 'Run stop reason:' "$LOG_FILE" | tail -1 || true)"

if [ -z "$summary_completed" ]; then summary_completed="n/a"; fi
if [ -z "$summary_failed" ]; then summary_failed="n/a"; fi
if [ -z "$summary_skipped" ]; then summary_skipped="n/a"; fi

if [ -n "$started_at" ] && [ -n "$completed_at" ]; then
  commits_in_window="$(git log --oneline --since="$started_at" --until="$completed_at" 2>/dev/null || true)"
else
  commits_in_window=""
fi

if [ -z "$commits_in_window" ]; then
  commits_in_window="$(git log --oneline -n 20 2>/dev/null || true)"
fi

{
  echo "# night-shift-report"
  echo
  echo "## Run Identity"
  echo "- Run ID: \`$run_id\`"
  echo "- Started: \`${started_at:-unknown}\`"
  echo "- Completed: \`${completed_at:-unknown}\`"
  echo "- Active branch at report time: \`${branch:-unknown}\`"
  if [ -n "$project_line" ]; then
    echo "- ${project_line#*] }"
  fi
  if [ -n "$tasks_file_line" ]; then
    echo "- ${tasks_file_line#*] }"
  fi
  echo

  echo "## Final Outcome"
  echo "- Completed tasks: **$summary_completed**"
  echo "- Failed tasks: **$summary_failed**"
  echo "- Skipped tasks: **$summary_skipped**"
  if [ -n "$duration_line" ]; then
    echo "- ${duration_line#*] }"
  fi
  if [ -n "$iterations_line" ]; then
    echo "- ${iterations_line#*] }"
  fi
  if [ -n "$backlog_line" ]; then
    echo "- ${backlog_line#*] }"
  fi
  if [ -n "$stop_reason_line" ]; then
    echo "- ${stop_reason_line#*] }"
  else
    echo "- Run stop reason: all_tasks_processed_or_circuit_breaker_not_triggered"
  fi
  echo

  echo "## Task Execution Timeline"
  if grep -Eq '\[[0-9]+/[0-9]+\]|Task: |Attempt |Tests passed|Tests failed|Completed: |Failed: |Failure category: |Task duration \(seconds\): ' "$LOG_FILE"; then
    grep -E '\[[0-9]+/[0-9]+\]|Task: |Attempt |Tests passed|Tests failed|Completed: |Failed: |Failure category: |Task duration \(seconds\): ' "$LOG_FILE" \
      | sed -E 's/^\[([^]]+)\] /- [\1] /'
  else
    echo "- No task timeline markers found."
  fi
  echo

  echo "## Commits Produced During Run"
  if [ -n "$commits_in_window" ]; then
    printf '%s\n' "$commits_in_window" | sed 's/^/- /'
  else
    echo "- No commits detected in run window."
  fi
  echo

  echo "## Backlog Snapshot"
  if [ -f docs/REVISION_BACKLOG.md ]; then
    grep -E '^- \[[ x]\] P[0-3] \|' docs/REVISION_BACKLOG.md || true
  else
    echo "- docs/REVISION_BACKLOG.md not found"
  fi
  echo

  echo "## Artifacts"
  echo "- Source log: \`$LOG_FILE\`"
  echo "- Versioned report: \`$out_file\`"
  echo "- Latest report alias: \`$latest_file\`"
} > "$out_file"

cp "$out_file" "$latest_file"
echo "$out_file"
