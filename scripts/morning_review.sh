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

DIR="${DEV_FACTORY_DIR:-$HOME/project}"
cd "$DIR"

echo "MORNING REVIEW"
echo "$(date '+%A, %B %d %Y at %H:%M')"
echo ""

REPORT="logs/reports/night-shift-report.md"
if [ -f "$REPORT" ]; then
  echo "-- NIGHT-SHIFT-REPORT --"
  echo "$REPORT"
  sed -n '1,180p' "$REPORT"
  echo ""
fi

LOG=$(ls -t logs/night_*.log 2>/dev/null | head -1 || true)
if [ -z "$LOG" ]; then
  echo "No logs found."
else
  echo "-- RESULTS --"
  grep -E "(Completed:|Failed:|Skipped:|Circuit breaker|NIGHT RUN COMPLETE)" "$LOG" | tail -15 || true
fi

echo ""
echo "-- COMMITS (last 12h) --"
git log --oneline --since="12 hours ago" || true

echo ""
echo "-- FILES CHANGED --"
git diff --name-only HEAD~10..HEAD 2>/dev/null | head -20 || true

echo ""
echo "-- TEST STATUS --"
npx vitest run 2>&1 | tail -20 || true

echo ""
echo "-- NEXT --"
echo "1) Review diffs: git diff HEAD~5..HEAD"
echo "2) If good: push/merge"
echo "3) If not: update tasks.md and rerun"

echo ""
echo "-- BACKLOG PROGRESS --"
if [ -f docs/REVISION_BACKLOG.md ]; then
  open_count=$(grep -E "^- \[ \] P[0-3] \|" docs/REVISION_BACKLOG.md | wc -l | xargs)
  done_count=$(grep -E "^- \[x\] P[0-3] \|" docs/REVISION_BACKLOG.md | wc -l | xargs)
  echo "Open: $open_count | Done: $done_count"
  echo "Next 3 open items:"
  grep -E "^- \[ \] P[0-3] \|" docs/REVISION_BACKLOG.md | head -3 | sed "s/^- \[ \] /  - /"
else
  echo "docs/REVISION_BACKLOG.md not found"
fi
