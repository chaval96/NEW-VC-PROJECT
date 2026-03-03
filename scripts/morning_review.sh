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
MORNING_TEST_CMD="${DEV_FACTORY_MORNING_TEST_CMD:-npx vitest run tests/unit/sanity.test.ts}"
cd "$DIR"

echo "MORNING REVIEW"
echo "$(date '+%A, %B %d %Y at %H:%M')"
echo ""

REPORT="logs/reports/night-shift-report.md"
if [ -f "$REPORT" ]; then
  echo "-- NIGHT-SHIFT REPORT --"
  echo "Path: $REPORT"
  awk '
    /^## Final Outcome/ { in_section=1 }
    /^## / && in_section && !/^## Final Outcome/ { exit }
    in_section { print }
  ' "$REPORT" || true
  echo ""
fi

LOG="$(ls -t logs/night_*.log 2>/dev/null | head -1 || true)"
if [ -z "$LOG" ]; then
  echo "-- LATEST RUN --"
  echo "No logs found."
else
  echo "-- LATEST RUN --"
  echo "Log: $LOG"
  grep -E "(NIGHT RUN COMPLETE|Duration \(minutes\):|Completed:|Failed:|Skipped:|Run stop reason:|Backlog progress:|Budget night usage:)" "$LOG" | tail -20 || true
fi


echo ""
echo "-- COMMITS (last 12h) --"
git log --oneline --since="12 hours ago" | head -20 || true

echo ""
echo "-- FILES CHANGED (recent) --"
git diff --name-only HEAD~20..HEAD 2>/dev/null | head -30 || true

echo ""
echo "-- TEST STATUS (morning quick check) --"
echo "Command: $MORNING_TEST_CMD"
bash -lc "$MORNING_TEST_CMD" 2>&1 | tail -30 || true

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


echo ""
echo "-- NEXT --"
echo "1) Review report and diff details"
echo "2) Merge/push if quality is acceptable"
echo "3) Adjust backlog priorities before next night run"
