#!/bin/bash
set -euo pipefail
source ~/.bashrc

DIR="${DEV_FACTORY_DIR:-$HOME/project}"
cd "$DIR"

echo "MORNING REVIEW"
echo "$(date '+%A, %B %d %Y at %H:%M')"
echo ""

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
