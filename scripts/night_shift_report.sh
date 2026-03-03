#!/bin/bash
set -euo pipefail

DIR="${DEV_FACTORY_DIR:-$HOME/project}"
cd "$DIR"

LOG_FILE="${1:-}"
LOG_FILE_PROVIDED=false
if [ -n "$LOG_FILE" ]; then
  LOG_FILE_PROVIDED=true
fi

if [ -z "$LOG_FILE" ]; then
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if grep -q 'NIGHT RUN COMPLETE' "$candidate"; then
      LOG_FILE="$candidate"
      break
    fi
  done < <(ls -1t logs/night_*.log 2>/dev/null || true)
fi

if [ -z "$LOG_FILE" ] || [ ! -f "$LOG_FILE" ]; then
  echo "ERROR: log file not found" >&2
  exit 1
fi

if ! grep -q 'NIGHT RUN COMPLETE' "$LOG_FILE"; then
  if [ "$LOG_FILE_PROVIDED" = false ]; then
    echo "ERROR: no completed night run log found yet" >&2
    exit 2
  fi
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
review_failures_count="$(grep -Ec 'Failure category: review_failure' "$LOG_FILE" || true)"
test_failures_count="$(grep -Ec 'Failure category: test_failure' "$LOG_FILE" || true)"
budget_failures_count="$(grep -Ec 'Failure category: budget_guard' "$LOG_FILE" || true)"
review_pass_count="$(grep -Ec 'Review gate passed' "$LOG_FILE" || true)"
budget_checks_count="$(grep -Ec 'Budget guard:' "$LOG_FILE" || true)"
budget_night_usage_line="$(grep -E 'Budget night usage:' "$LOG_FILE" | tail -1 || true)"

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

  echo "## Executive Summary"
  if [ "$summary_failed" = "0" ] && [ "$summary_completed" != "0" ]; then
    echo "- Overall: run completed tasks successfully with no failed tasks."
  elif [ "$summary_failed" = "0" ] && [ "$summary_completed" = "0" ]; then
    echo "- Overall: run finished without task completion (check stop reason and backlog state)."
  else
    echo "- Overall: run ended with failures; inspect timeline and review feedback before merge."
  fi
  echo "- Review gate passes: **$review_pass_count**"
  echo "- Review gate failures: **$review_failures_count**"
  echo "- Test failures encountered: **$test_failures_count**"
  echo "- Budget guard checks: **$budget_checks_count**"
  echo "- Budget guard failure events: **$budget_failures_count**"
  if [ -n "$budget_night_usage_line" ]; then
    echo "- ${budget_night_usage_line#*] }"
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
