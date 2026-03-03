#!/bin/bash
set -euo pipefail

INPUT_TASKS_FILE="${1:-tasks.md}"

if [[ "$INPUT_TASKS_FILE" = /* ]]; then
  TASKS_FILE="$INPUT_TASKS_FILE"
else
  TASKS_FILE="$(pwd)/$INPUT_TASKS_FILE"
fi

PROJECT_DIR="$(cd "$(dirname "$TASKS_FILE")" && pwd)"
cd "$PROJECT_DIR"

LOG_FILE="${DEV_FACTORY_LOG_FILE:-$PROJECT_DIR/night.log}"
MAX_RETRIES="${MAX_RETRIES_PER_TASK:-8}"
MAX_CONSEC_FAILS="${MAX_CONSECUTIVE_FAILURES:-3}"
MAX_TOTAL_ITERATIONS="${DEV_FACTORY_MAX_TOTAL_ITERATIONS:-50}"
TEST_CMD="${DEV_FACTORY_TEST_CMD:-npx vitest run}"
LINT_CMD="${DEV_FACTORY_LINT_CMD:-npx tsc --noEmit}"

PLANNING_ENABLED="${DEV_FACTORY_ENABLE_PLANNING:-true}"
PLANNING_TIMEOUT_SECONDS="${DEV_FACTORY_PLANNING_TIMEOUT_SECONDS:-120}"
PLANNING_MODEL="${DEV_FACTORY_PLANNING_MODEL:-anthropic/claude-sonnet-4}"
AIDER_TASK_TIMEOUT_SECONDS="${DEV_FACTORY_AIDER_TASK_TIMEOUT_SECONDS:-600}"
BACKLOG_FILE="${DEV_FACTORY_BACKLOG_FILE:-$PROJECT_DIR/docs/REVISION_BACKLOG.md}"

REVIEW_GATE_ENABLED="${DEV_FACTORY_REVIEW_GATE_ENABLED:-true}"
REVIEW_MODEL="${DEV_FACTORY_REVIEW_MODEL:-anthropic/claude-sonnet-4}"
REVIEW_ENDPOINT="${DEV_FACTORY_REVIEW_ENDPOINT:-https://openrouter.ai/api/v1/chat/completions}"
REVIEW_MAX_DIFF_CHARS="${DEV_FACTORY_REVIEW_MAX_DIFF_CHARS:-24000}"
REVIEW_FAIL_OPEN="${DEV_FACTORY_REVIEW_FAIL_OPEN:-false}"
REVIEW_FAIL_OPEN_ON_API_ERROR="${DEV_FACTORY_REVIEW_FAIL_OPEN_ON_API_ERROR:-false}"
REVIEW_API_RETRIES="${DEV_FACTORY_REVIEW_API_RETRIES:-2}"
REVIEW_API_RETRY_DELAY_SECONDS="${DEV_FACTORY_REVIEW_API_RETRY_DELAY_SECONDS:-1.5}"
REVIEW_API_TIMEOUT_SECONDS="${DEV_FACTORY_REVIEW_API_TIMEOUT_SECONDS:-45}"

BUDGET_GUARD_ENABLED="${DEV_FACTORY_BUDGET_GUARD_ENABLED:-true}"
BUDGET_ENDPOINT="${DEV_FACTORY_BUDGET_ENDPOINT:-https://openrouter.ai/api/v1/key}"
BUDGET_MIN_REMAINING_USD="${DEV_FACTORY_MIN_REMAINING_USD:-1.00}"
BUDGET_MAX_USAGE_USD="${DEV_FACTORY_MAX_USAGE_USD:-0}"
BUDGET_MAX_NIGHT_USAGE_USD="${DEV_FACTORY_MAX_NIGHT_USAGE_USD:-0}"
BUDGET_FAIL_OPEN="${DEV_FACTORY_BUDGET_FAIL_OPEN:-true}"
BUDGET_CHECK_INTERVAL_SECONDS="${DEV_FACTORY_BUDGET_CHECK_INTERVAL_SECONDS:-300}"
BUDGET_API_RETRIES="${DEV_FACTORY_BUDGET_API_RETRIES:-2}"
BUDGET_API_RETRY_DELAY_SECONDS="${DEV_FACTORY_BUDGET_API_RETRY_DELAY_SECONDS:-1.5}"
BUDGET_API_TIMEOUT_SECONDS="${DEV_FACTORY_BUDGET_API_TIMEOUT_SECONDS:-20}"
RUN_UNTIL_MORNING="${DEV_FACTORY_RUN_UNTIL_MORNING:-false}"
RUN_UNTIL_LOCAL_HHMM="${DEV_FACTORY_RUN_UNTIL_LOCAL_HHMM:-08:00}"
RUN_UNTIL_TZ="${DEV_FACTORY_RUN_UNTIL_TZ:-UTC}"
SYNC_TASKS_EACH_WAVE="${DEV_FACTORY_SYNC_TASKS_EACH_WAVE:-true}"

TEST_OUTPUT="$(mktemp /tmp/dev_factory_test_output.XXXXXX)"
REVIEW_OUTPUT="$(mktemp /tmp/dev_factory_review_output.XXXXXX)"
REVIEW_DIFF_FILE="$(mktemp /tmp/dev_factory_review_diff.XXXXXX)"
REVIEW_TASK_FILE="$(mktemp /tmp/dev_factory_review_task.XXXXXX)"

COMPLETED=0
FAILED=0
SKIPPED=0
CONSECUTIVE_FAILS=0
TOTAL_ITERATIONS=0
LAST_BUDGET_CHECK_TS=0
START_TS="$(date +%s)"
LOCKED_ACCEPTANCE=false
ITERATION_CAP_HIT=false
BUDGET_BLOCKED=false
REVIEW_FEEDBACK=""
RUN_UNTIL_TS=0
BUDGET_BASELINE_USAGE_USD=""
BUDGET_LAST_USAGE_USD=""
BUDGET_LAST_USAGE_DELTA_USD=""

AIDER_ARGS=(--yes-always --no-stream)
if [ -f "$PROJECT_DIR/.aider.conf.yml" ]; then
  AIDER_ARGS+=(--config "$PROJECT_DIR/.aider.conf.yml")
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

is_non_negative_number() {
  local value="$1"
  python3 - "$value" <<'PY'
import sys
try:
    v = float(sys.argv[1])
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if v >= 0 else 1)
PY
}

number_gt_zero() {
  local value="$1"
  python3 - "$value" <<'PY'
import sys
try:
    v = float(sys.argv[1])
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if v > 0 else 1)
PY
}

number_gt() {
  local left="$1"
  local right="$2"
  python3 - "$left" "$right" <<'PY'
import sys
try:
    left = float(sys.argv[1])
    right = float(sys.argv[2])
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if left > right else 1)
PY
}

number_sub_non_negative() {
  local left="$1"
  local right="$2"
  python3 - "$left" "$right" <<'PY'
import sys
left = float(sys.argv[1])
right = float(sys.argv[2])
value = left - right
if value < 0:
    value = 0.0
print(f"{value:.6f}")
PY
}

extract_usage_from_budget_status() {
  python3 - <<'PY'
import json
import sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)
value = data.get("usage")
if isinstance(value, (int, float)) and not isinstance(value, bool):
    print(f"{float(value):.6f}")
else:
    print("")
PY
}

configure_run_until_cutoff() {
  local now_ts
  local today
  local cutoff

  if ! is_true "$RUN_UNTIL_MORNING"; then
    RUN_UNTIL_TS=0
    return 0
  fi

  if ! today="$(TZ="$RUN_UNTIL_TZ" date '+%Y-%m-%d' 2>/dev/null)"; then
    log "Invalid DEV_FACTORY_RUN_UNTIL_TZ='$RUN_UNTIL_TZ'; disabling run-until mode"
    RUN_UNTIL_MORNING=false
    RUN_UNTIL_TS=0
    return 1
  fi

  if ! cutoff="$(TZ="$RUN_UNTIL_TZ" date -d "$today $RUN_UNTIL_LOCAL_HHMM:00" +%s 2>/dev/null)"; then
    log "Invalid DEV_FACTORY_RUN_UNTIL_LOCAL_HHMM='$RUN_UNTIL_LOCAL_HHMM'; expected HH:MM; disabling run-until mode"
    RUN_UNTIL_MORNING=false
    RUN_UNTIL_TS=0
    return 1
  fi

  now_ts="$(date +%s)"
  if [ "$cutoff" -le "$now_ts" ]; then
    cutoff="$(TZ="$RUN_UNTIL_TZ" date -d "tomorrow $RUN_UNTIL_LOCAL_HHMM:00" +%s 2>/dev/null || true)"
  fi

  if [ -z "$cutoff" ]; then
    log "Failed to resolve run-until cutoff; disabling run-until mode"
    RUN_UNTIL_MORNING=false
    RUN_UNTIL_TS=0
    return 1
  fi

  RUN_UNTIL_TS="$cutoff"
  return 0
}

run_until_cutoff_reached() {
  if ! is_true "$RUN_UNTIL_MORNING"; then
    return 1
  fi

  [ "$RUN_UNTIL_TS" -gt 0 ] || return 1
  [ "$(date +%s)" -ge "$RUN_UNTIL_TS" ]
}

unlock_acceptance_tests() {
  if [ "$LOCKED_ACCEPTANCE" = true ] && [ -d "$PROJECT_DIR/tests/acceptance" ]; then
    find "$PROJECT_DIR/tests/acceptance" -type d -exec chmod 755 {} + 2>/dev/null || true
    find "$PROJECT_DIR/tests/acceptance" -type f -exec chmod 644 {} + 2>/dev/null || true
    LOCKED_ACCEPTANCE=false
    log "Acceptance tests unlocked"
  fi
}

cleanup() {
  unlock_acceptance_tests
  rm -f "$TEST_OUTPUT" "$REVIEW_OUTPUT" "$REVIEW_DIFF_FILE" "$REVIEW_TASK_FILE" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

preflight() {
  log "DEV FACTORY V2 NIGHT RUN START"
  log "Project: $PROJECT_DIR"
  log "Tasks file: $TASKS_FILE"
  log "Test command: $TEST_CMD"
  log "Max retries/task: $MAX_RETRIES"
  log "Max consecutive failures: $MAX_CONSEC_FAILS"
  log "Max total iterations: $MAX_TOTAL_ITERATIONS"
  log "Planning enabled: $PLANNING_ENABLED"
  log "Planning model: $PLANNING_MODEL"
  log "Review gate enabled: $REVIEW_GATE_ENABLED ($REVIEW_MODEL)"
  log "Review max diff chars: $REVIEW_MAX_DIFF_CHARS"
  log "Review fail-open on API error: $REVIEW_FAIL_OPEN_ON_API_ERROR"
  log "Review API retries/delay/timeout: $REVIEW_API_RETRIES / $REVIEW_API_RETRY_DELAY_SECONDS / $REVIEW_API_TIMEOUT_SECONDS"
  log "Budget guard enabled: $BUDGET_GUARD_ENABLED"
  log "Budget max night usage (USD): $BUDGET_MAX_NIGHT_USAGE_USD"
  log "Budget API retries/delay/timeout: $BUDGET_API_RETRIES / $BUDGET_API_RETRY_DELAY_SECONDS / $BUDGET_API_TIMEOUT_SECONDS"
  log "Run-until-morning mode: $RUN_UNTIL_MORNING"

  if [ ! -f "$TASKS_FILE" ]; then
    log "ERROR: tasks file not found"
    exit 1
  fi

  if ! command -v aider >/dev/null 2>&1; then
    log "ERROR: aider is not installed"
    exit 1
  fi

  if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    log "ERROR: OPENROUTER_API_KEY is not set"
    exit 1
  fi

  if [ "$PLANNING_ENABLED" = "true" ] && [ -z "$PLANNING_MODEL" ]; then
    log "ERROR: DEV_FACTORY_PLANNING_MODEL must not be empty when planning is enabled"
    exit 1
  fi

  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    log "ERROR: not inside a git repository"
    exit 1
  fi

  if [ "$REVIEW_GATE_ENABLED" = "true" ] || [ "$BUDGET_GUARD_ENABLED" = "true" ]; then
    if ! command -v python3 >/dev/null 2>&1; then
      log "ERROR: python3 is required for review/budget guards"
      exit 1
    fi
  fi

  if [ "$BUDGET_GUARD_ENABLED" = "true" ]; then
    if ! is_non_negative_number "$BUDGET_MAX_NIGHT_USAGE_USD"; then
      log "ERROR: DEV_FACTORY_MAX_NIGHT_USAGE_USD must be a non-negative number"
      exit 1
    fi
    if ! [[ "$BUDGET_API_RETRIES" =~ ^[0-9]+$ ]] || [ "$BUDGET_API_RETRIES" -lt 1 ]; then
      log "ERROR: DEV_FACTORY_BUDGET_API_RETRIES must be a positive integer"
      exit 1
    fi
    if ! is_non_negative_number "$BUDGET_API_RETRY_DELAY_SECONDS"; then
      log "ERROR: DEV_FACTORY_BUDGET_API_RETRY_DELAY_SECONDS must be a non-negative number"
      exit 1
    fi
    if ! number_gt_zero "$BUDGET_API_TIMEOUT_SECONDS"; then
      log "ERROR: DEV_FACTORY_BUDGET_API_TIMEOUT_SECONDS must be > 0"
      exit 1
    fi
  fi

  if [ "$REVIEW_GATE_ENABLED" = "true" ]; then
    if ! [[ "$REVIEW_API_RETRIES" =~ ^[0-9]+$ ]] || [ "$REVIEW_API_RETRIES" -lt 1 ]; then
      log "ERROR: DEV_FACTORY_REVIEW_API_RETRIES must be a positive integer"
      exit 1
    fi
    if ! is_non_negative_number "$REVIEW_API_RETRY_DELAY_SECONDS"; then
      log "ERROR: DEV_FACTORY_REVIEW_API_RETRY_DELAY_SECONDS must be a non-negative number"
      exit 1
    fi
    if ! number_gt_zero "$REVIEW_API_TIMEOUT_SECONDS"; then
      log "ERROR: DEV_FACTORY_REVIEW_API_TIMEOUT_SECONDS must be > 0"
      exit 1
    fi
  fi

  if [ "$REVIEW_GATE_ENABLED" = "true" ] && [ ! -f "$PROJECT_DIR/scripts/review_gate.py" ]; then
    log "ERROR: scripts/review_gate.py missing"
    exit 1
  fi

  if [ "$BUDGET_GUARD_ENABLED" = "true" ] && [ ! -f "$PROJECT_DIR/scripts/openrouter_budget_guard.py" ]; then
    log "ERROR: scripts/openrouter_budget_guard.py missing"
    exit 1
  fi

  mkdir -p "$PROJECT_DIR/logs" "$PROJECT_DIR/tests/acceptance" "$PROJECT_DIR/tests/unit"

  if [ -d "$PROJECT_DIR/tests/acceptance" ]; then
    find "$PROJECT_DIR/tests/acceptance" -type d -exec chmod 555 {} + 2>/dev/null || true
    find "$PROJECT_DIR/tests/acceptance" -type f -exec chmod 444 {} + 2>/dev/null || true
    LOCKED_ACCEPTANCE=true
    log "Acceptance tests locked (read-only)"
  fi

  if [ ! -f "$PROJECT_DIR/.aiderignore" ]; then
    cat > "$PROJECT_DIR/.aiderignore" << 'EOIGNORE'
tests/acceptance/
node_modules/
logs/
.env*
*.log
EOIGNORE
    log "Created default .aiderignore"
  fi

  if ! grep -q '^tests/acceptance/$' "$PROJECT_DIR/.aiderignore"; then
    echo "tests/acceptance/" >> "$PROJECT_DIR/.aiderignore"
    log "Added tests/acceptance/ to .aiderignore"
  fi

  configure_run_until_cutoff || true
  if is_true "$RUN_UNTIL_MORNING" && [ "$RUN_UNTIL_TS" -gt 0 ]; then
    log "Run-until cutoff: $(date -d "@$RUN_UNTIL_TS" '+%Y-%m-%d %H:%M:%S %Z') (TZ=$RUN_UNTIL_TZ)"
  fi

  log ""
}

extract_global_rules() {
  awk '
    $0 == "## GLOBAL RULES" { in_rules = 1; next }
    in_rules && /^## / { exit }
    in_rules { print }
  ' "$TASKS_FILE"
}

extract_task_names() {
  grep '^## Task' "$TASKS_FILE" | sed 's/^## //'
}

extract_task_body() {
  local task_header="$1"
  awk -v header="## ${task_header}" '
    $0 == header { in_task = 1; next }
    in_task && /^## / { exit }
    in_task { print }
  ' "$TASKS_FILE"
}

run_lint() {
  if [ -n "$LINT_CMD" ]; then
    bash -lc "$LINT_CMD" >/dev/null 2>&1 || true
  fi
}

run_tests() {
  if bash -lc "$TEST_CMD" >"$TEST_OUTPUT" 2>&1; then
    log "Tests passed"
    return 0
  fi

  log "Tests failed"
  log "Failure category: test_failure"
  tail -20 "$TEST_OUTPUT" | tee -a "$LOG_FILE" >/dev/null
  return 1
}

check_budget_guard() {
  if [ "$BUDGET_GUARD_ENABLED" != "true" ]; then
    return 0
  fi

  local now
  local age
  local status
  local usage
  local usage_delta

  now="$(date +%s)"
  if [ "$LAST_BUDGET_CHECK_TS" -gt 0 ]; then
    age=$((now - LAST_BUDGET_CHECK_TS))
    if [ "$age" -lt "$BUDGET_CHECK_INTERVAL_SECONDS" ]; then
      return 0
    fi
  fi
  LAST_BUDGET_CHECK_TS="$now"

  if status="$(python3 "$PROJECT_DIR/scripts/openrouter_budget_guard.py" \
      --api-key "$OPENROUTER_API_KEY" \
      --endpoint "$BUDGET_ENDPOINT" \
      --min-remaining "$BUDGET_MIN_REMAINING_USD" \
      --max-usage "$BUDGET_MAX_USAGE_USD" \
      --fail-open "$BUDGET_FAIL_OPEN" \
      --timeout "$BUDGET_API_TIMEOUT_SECONDS" \
      --retries "$BUDGET_API_RETRIES" \
      --retry-delay "$BUDGET_API_RETRY_DELAY_SECONDS" 2>>"$LOG_FILE")"; then
    log "Budget guard: $status"

    if number_gt_zero "$BUDGET_MAX_NIGHT_USAGE_USD"; then
      usage="$(printf '%s' "$status" | extract_usage_from_budget_status)"
      if [ -z "$usage" ]; then
        log "Budget night cap warning: usage metric unavailable, cannot enforce nightly delta cap"
      else
        BUDGET_LAST_USAGE_USD="$usage"
        if [ -z "$BUDGET_BASELINE_USAGE_USD" ]; then
          BUDGET_BASELINE_USAGE_USD="$usage"
          log "Budget baseline usage set: $BUDGET_BASELINE_USAGE_USD USD"
        fi

        if number_gt "$BUDGET_BASELINE_USAGE_USD" "$usage"; then
          BUDGET_BASELINE_USAGE_USD="$usage"
          log "Budget baseline reset due to usage counter drop: $BUDGET_BASELINE_USAGE_USD USD"
        fi

        usage_delta="$(number_sub_non_negative "$usage" "$BUDGET_BASELINE_USAGE_USD")"
        BUDGET_LAST_USAGE_DELTA_USD="$usage_delta"
        log "Budget night usage: $usage_delta / $BUDGET_MAX_NIGHT_USAGE_USD USD"

        if number_gt "$usage_delta" "$BUDGET_MAX_NIGHT_USAGE_USD"; then
          log "Failure category: budget_guard"
          log "Budget guard blocked execution"
          log "Budget guard detail: night_usage_delta>${BUDGET_MAX_NIGHT_USAGE_USD} (delta=$usage_delta baseline=$BUDGET_BASELINE_USAGE_USD current=$usage)"
          BUDGET_BLOCKED=true
          return 1
        fi
      fi
    fi

    return 0
  fi

  log "Failure category: budget_guard"
  log "Budget guard blocked execution"
  log "Budget guard detail: $status"
  BUDGET_BLOCKED=true
  return 1
}

run_review_gate() {
  local task_name="$1"
  local task_body="$2"
  local summary

  REVIEW_FEEDBACK=""

  if [ "$REVIEW_GATE_ENABLED" != "true" ]; then
    log "Review gate skipped (DEV_FACTORY_REVIEW_GATE_ENABLED=false)"
    return 0
  fi

  : > "$REVIEW_OUTPUT"
  : > "$REVIEW_DIFF_FILE"
  : > "$REVIEW_TASK_FILE"

  git add -N . >/dev/null 2>&1 || true
  {
    echo "Changed files:"
    git diff --name-only -- . ':(exclude)tests/acceptance' | sed 's/^/- /'
    echo
    echo "Patch (truncated):"
    git diff -- . ':(exclude)tests/acceptance'
  } | head -c "$REVIEW_MAX_DIFF_CHARS" > "$REVIEW_DIFF_FILE"
  printf '%s\n' "$task_body" > "$REVIEW_TASK_FILE"

  if [ ! -s "$REVIEW_DIFF_FILE" ]; then
    log "Review gate: empty diff; pass"
    return 0
  fi

  if python3 "$PROJECT_DIR/scripts/review_gate.py" \
      --api-key "$OPENROUTER_API_KEY" \
      --endpoint "$REVIEW_ENDPOINT" \
      --model "$REVIEW_MODEL" \
      --task-name "$task_name" \
      --task-body-file "$REVIEW_TASK_FILE" \
      --diff-file "$REVIEW_DIFF_FILE" \
      --fail-open "$REVIEW_FAIL_OPEN" \
      --fail-open-on-api-error "$REVIEW_FAIL_OPEN_ON_API_ERROR" \
      --api-retries "$REVIEW_API_RETRIES" \
      --api-retry-delay "$REVIEW_API_RETRY_DELAY_SECONDS" \
      --api-timeout "$REVIEW_API_TIMEOUT_SECONDS" > "$REVIEW_OUTPUT" 2>>"$LOG_FILE"; then
    summary="$(python3 - "$REVIEW_OUTPUT" <<'PY'
import json
import sys
try:
    data = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
except Exception:
    print('')
    raise SystemExit(0)
print(str(data.get('summary', '')).replace('\n', ' ').strip())
PY
)"
    log "Review gate passed ($REVIEW_MODEL)"
    if [ -n "$summary" ]; then
      log "Review summary: $summary"
    fi
    return 0
  fi

  REVIEW_FEEDBACK="$(python3 - "$REVIEW_OUTPUT" <<'PY'
import json
import sys
try:
    data = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
except Exception:
    print('review_output_parse_error')
    raise SystemExit(0)
vals = []
for key in ('feedback', 'blockers', 'required_fixes'):
    value = data.get(key, [])
    if isinstance(value, list):
        vals.extend(str(item).strip() for item in value if str(item).strip())
    elif isinstance(value, str) and value.strip():
        vals.append(value.strip())
print(' | '.join(vals)[:2000])
PY
)"

  log "Failure category: review_failure"
  log "Review gate failed ($REVIEW_MODEL)"
  if [ -n "$REVIEW_FEEDBACK" ]; then
    log "Review feedback: $REVIEW_FEEDBACK"
  fi
  return 1
}

generate_local_plan() {
  local global_rules="$1"
  {
    echo "# plan.md"
    echo
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Source: $TASKS_FILE"
    echo
    echo "## Global Rules"
    echo "$global_rules"
    echo
    echo "## Task Breakdown"

    local idx=1
    while IFS= read -r task_name; do
      [ -n "$task_name" ] || continue
      echo "### ${idx}. $task_name"
      extract_task_body "$task_name" | sed 's/^/- /'
      echo
      idx=$((idx + 1))
    done < <(extract_task_names)
  } > "$PROJECT_DIR/plan.md"

  log "Lightweight local plan generated: plan.md"
}

planning_phase() {
  local global_rules="$1"
  local planning_prompt

  if [ "$PLANNING_ENABLED" != "true" ]; then
    log "Planning phase skipped (DEV_FACTORY_ENABLE_PLANNING=false)"
    generate_local_plan "$global_rules"
    log ""
    return
  fi

  planning_prompt=$(cat << EOPLAN
Read tasks.md and create plan.md with:
1. task execution order,
2. files to modify for each task,
3. test risks and edge cases.

GLOBAL RULES:
$global_rules

Do not modify anything under tests/acceptance/.
EOPLAN
)

  log "Planning phase ($PLANNING_MODEL)"
  if timeout "$PLANNING_TIMEOUT_SECONDS" aider "${AIDER_ARGS[@]}" \
    --model "$PLANNING_MODEL" \
    --message "$planning_prompt" \
    --file "$TASKS_FILE" >> "$LOG_FILE" 2>&1; then
    if [ -f "$PROJECT_DIR/plan.md" ]; then
      log "Plan created: plan.md"
    else
      log "Planner exited successfully but plan.md missing; generating local fallback"
      generate_local_plan "$global_rules"
    fi
  else
    log "Planning phase returned non-zero exit code"
    log "Generating local fallback plan"
    generate_local_plan "$global_rules"
  fi

  log ""
}

mark_backlog_task_done() {
  local task_name="$1"
  local title
  local ts
  local marker_file

  [ -f "$BACKLOG_FILE" ] || return 0

  title="$(printf '%s' "$task_name" | sed -E 's/^Task[[:space:]]+[0-9]+:[[:space:]]*//')"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  marker_file="/tmp/dev_factory_backlog_marked.$$"

  awk -v title="$title" -v ts="$ts" -v marker="$marker_file" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    BEGIN { marked = 0 }
    {
      if (!marked && $0 ~ /^- \[ \] P[0-3] \|/) {
        n = split($0, parts, "|")
        if (n >= 4) {
          current = trim(parts[2])
          if (current == title) {
            sub(/^- \[ \]/, "- [x]")
            $0 = $0 " | Completed: " ts
            marked = 1
          }
        }
      }
      print
    }
    END {
      if (marked == 1) {
        print "1" > marker
      }
    }
  ' "$BACKLOG_FILE" > "$BACKLOG_FILE.tmp"
  mv "$BACKLOG_FILE.tmp" "$BACKLOG_FILE"

  if [ -f "$marker_file" ]; then
    rm -f "$marker_file"
    log "Backlog updated: '$title' marked done"
  else
    log "Backlog note: no matching open item for '$title'"
  fi
}

run_task() {
  local task_name="$1"
  local task_body="$2"
  local global_rules="$3"
  local attempt=0
  local task_ok=false
  local safe_task_name
  local task_start_ts
  local task_end_ts
  local elapsed

  task_start_ts="$(date +%s)"
  safe_task_name="$(printf '%s' "$task_name" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"

  log "Task: $safe_task_name"

  local prompt
  prompt=$(cat << EOTASK
GLOBAL RULES:
$global_rules

CURRENT TASK:
$task_body

IMPORTANT:
- tests/acceptance/ is read-only. Never modify it.
- If tests fail, fix code and implementation.
- Keep changes minimal and well-scoped to this task.
EOTASK
)

  while [ "$attempt" -lt "$MAX_RETRIES" ]; do
    if [ "$TOTAL_ITERATIONS" -ge "$MAX_TOTAL_ITERATIONS" ]; then
      ITERATION_CAP_HIT=true
      log "Global iteration cap reached ($TOTAL_ITERATIONS/$MAX_TOTAL_ITERATIONS)"
      break
    fi

    if ! check_budget_guard; then
      break
    fi

    attempt=$((attempt + 1))
    TOTAL_ITERATIONS=$((TOTAL_ITERATIONS + 1))
    log "Attempt $attempt/$MAX_RETRIES (global $TOTAL_ITERATIONS/$MAX_TOTAL_ITERATIONS)"

    timeout "$AIDER_TASK_TIMEOUT_SECONDS" aider "${AIDER_ARGS[@]}" --message "$prompt" >> "$LOG_FILE" 2>&1 || true
    run_lint

    if run_tests; then
      if run_review_gate "$safe_task_name" "$task_body"; then
        task_ok=true
        break
      fi

      if [ "$attempt" -lt "$MAX_RETRIES" ]; then
        prompt=$(cat << EOREVIEW
The last implementation passed tests but failed strict review.
Fix all review blockers.

REVIEW FEEDBACK:
$REVIEW_FEEDBACK

ORIGINAL TASK:
$task_body

RULES:
- tests/acceptance/ is read-only.
- Keep behavior stable and avoid regressions.
EOREVIEW
)
      fi

      continue
    fi

    if [ "$attempt" -lt "$MAX_RETRIES" ]; then
      local test_errors
      test_errors="$(tail -20 "$TEST_OUTPUT")"
      prompt=$(cat << EORETRY
The last implementation failed tests.
Fix the code only.

TEST FAILURES:
$test_errors

ORIGINAL TASK:
$task_body

RULES:
- tests/acceptance/ is read-only.
- Do not change tests to force a pass.
EORETRY
)
    fi
  done

  task_end_ts="$(date +%s)"
  elapsed=$((task_end_ts - task_start_ts))

  if [ "$task_ok" = true ]; then
    log "Completed: $safe_task_name"
    log "Task duration (seconds): $elapsed"
    COMPLETED=$((COMPLETED + 1))
    CONSECUTIVE_FAILS=0
    mark_backlog_task_done "$safe_task_name"
    git add -A
    git commit -m "feat: $safe_task_name [dev-factory]" --allow-empty >/dev/null 2>&1 || true
  else
    log "Failed: $safe_task_name"
    log "Task duration (seconds): $elapsed"
    FAILED=$((FAILED + 1))
    CONSECUTIVE_FAILS=$((CONSECUTIVE_FAILS + 1))

    if [ "$ITERATION_CAP_HIT" = true ]; then
      log "Stop reason: iteration_cap"
    fi
    if [ "$BUDGET_BLOCKED" = true ]; then
      log "Stop reason: budget_guard"
    fi

    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      git stash push --include-untracked -m "dev-factory failed task: $safe_task_name" >/dev/null 2>&1 || true
      log "Stashed failed task changes"
    fi
  fi

  log ""
}

emit_night_shift_report() {
  local report_path
  if [ ! -x "$PROJECT_DIR/scripts/night_shift_report.sh" ]; then
    log "Night shift report skipped: script missing"
    return
  fi

  if report_path="$(bash "$PROJECT_DIR/scripts/night_shift_report.sh" "$LOG_FILE" 2>>"$LOG_FILE")"; then
    log "night-shift-report generated: $report_path"
  else
    log "Night shift report generation failed"
  fi
}

log_backlog_progress() {
  if [ -f "$BACKLOG_FILE" ]; then
    local open_count
    local done_count
    open_count="$(grep -Ec '^- \[ \] P[0-3] \|' "$BACKLOG_FILE" || true)"
    done_count="$(grep -Ec '^- \[x\] P[0-3] \|' "$BACKLOG_FILE" || true)"
    log "Backlog progress: open=$open_count done=$done_count"
  fi
}

count_open_backlog_items() {
  if [ ! -f "$BACKLOG_FILE" ]; then
    echo "0"
    return
  fi

  grep -Ec '^- \[ \] P[0-3] \|' "$BACKLOG_FILE" || true
}

refresh_tasks_from_backlog() {
  local refresh_output

  if [ "$SYNC_TASKS_EACH_WAVE" != "true" ]; then
    log "Task refresh skipped (DEV_FACTORY_SYNC_TASKS_EACH_WAVE=false)"
    return 1
  fi

  if [ ! -x "$PROJECT_DIR/scripts/sync_tasks_from_backlog.sh" ]; then
    log "Task refresh unavailable: scripts/sync_tasks_from_backlog.sh is missing or not executable"
    return 1
  fi

  if refresh_output="$(bash "$PROJECT_DIR/scripts/sync_tasks_from_backlog.sh" "$BACKLOG_FILE" "$TASKS_FILE" 2>&1)"; then
    log "Task refresh: $refresh_output"
    return 0
  fi

  log "Task refresh failed: $refresh_output"
  return 1
}

main() {
  preflight

  if ! check_budget_guard; then
    log "Budget guard blocked run before execution phase"
    log "NIGHT RUN COMPLETE"
    log "Completed: 0"
    log "Failed: 0"
    log "Skipped: 0"
    emit_night_shift_report
    return
  fi

  local global_rules
  global_rules="$(extract_global_rules)"

  planning_phase "$global_rules"

  local wave=1
  local run_until_stopped=false
  local tasks=()
  local total
  local index
  local task_name
  local task_body
  local open_count

  while true; do
    tasks=()
    while IFS= read -r task_line; do
      [ -n "$task_line" ] || continue
      tasks+=("$task_line")
    done < <(extract_task_names)

    total="${#tasks[@]}"
    if [ "$total" -eq 0 ]; then
      if [ "$wave" -eq 1 ]; then
        log "No tasks found in tasks.md. Add headings like: ## Task 1: ..."
        exit 1
      fi
      log "No tasks available for next wave; stopping"
      break
    fi

    log "Execution phase (wave $wave)"
    log "Tasks found: $total"
    log ""

    index=0
    for task_name in "${tasks[@]}"; do
      if [ "$CONSECUTIVE_FAILS" -ge "$MAX_CONSEC_FAILS" ]; then
        SKIPPED=$((SKIPPED + total - index))
        log "Circuit breaker triggered ($CONSECUTIVE_FAILS consecutive failures)"
        break
      fi

      if [ "$ITERATION_CAP_HIT" = true ]; then
        SKIPPED=$((SKIPPED + total - index))
        log "Global iteration cap stop activated"
        break
      fi

      if [ "$BUDGET_BLOCKED" = true ]; then
        SKIPPED=$((SKIPPED + total - index))
        log "Budget guard stop activated"
        break
      fi

      index=$((index + 1))
      log "[$index/$total]"
      task_body="$(extract_task_body "$task_name")"
      run_task "$task_name" "$task_body" "$global_rules"
    done

    log_backlog_progress

    if [ "$CONSECUTIVE_FAILS" -ge "$MAX_CONSEC_FAILS" ] || [ "$ITERATION_CAP_HIT" = true ] || [ "$BUDGET_BLOCKED" = true ]; then
      break
    fi

    if ! is_true "$RUN_UNTIL_MORNING"; then
      break
    fi

    if run_until_cutoff_reached; then
      run_until_stopped=true
      log "Run-until cutoff reached; stopping"
      break
    fi

    open_count="$(count_open_backlog_items)"
    if [ "$open_count" -eq 0 ]; then
      log "No open backlog items remain; stopping before cutoff"
      break
    fi

    if ! refresh_tasks_from_backlog; then
      log "Unable to refresh tasks for next wave; stopping run-until mode"
      break
    fi

    wave=$((wave + 1))
    log "Continuing to wave $wave"
    log ""
  done

  local end_ts
  local duration_min
  end_ts="$(date +%s)"
  duration_min=$(( (end_ts - START_TS) / 60 ))

  log "NIGHT RUN COMPLETE"
  log "Duration (minutes): $duration_min"
  log "Completed: $COMPLETED"
  log "Failed: $FAILED"
  log "Skipped: $SKIPPED"
  log "Total iterations: $TOTAL_ITERATIONS/$MAX_TOTAL_ITERATIONS"

  if [ "$ITERATION_CAP_HIT" = true ]; then
    log "Run stop reason: iteration_cap"
  fi
  if [ "$BUDGET_BLOCKED" = true ]; then
    log "Run stop reason: budget_guard"
  fi
  if [ "$run_until_stopped" = true ]; then
    log "Run stop reason: run_until_cutoff"
  fi

  log "Recent commits:"
  git log --oneline -10 >> "$LOG_FILE" 2>/dev/null || true
  emit_night_shift_report
}

main
