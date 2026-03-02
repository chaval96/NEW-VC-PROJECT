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
TEST_CMD="${DEV_FACTORY_TEST_CMD:-npx vitest run}"
LINT_CMD="${DEV_FACTORY_LINT_CMD:-npx tsc --noEmit}"
TEST_OUTPUT="$(mktemp /tmp/dev_factory_test_output.XXXXXX)"

COMPLETED=0
FAILED=0
SKIPPED=0
CONSECUTIVE_FAILS=0
START_TS="$(date +%s)"
LOCKED_ACCEPTANCE=false

AIDER_ARGS=(--yes-always --no-stream)
if [ -f "$PROJECT_DIR/.aider.conf.yml" ]; then
  AIDER_ARGS+=(--config "$PROJECT_DIR/.aider.conf.yml")
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
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
  rm -f "$TEST_OUTPUT" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

preflight() {
  log "DEV FACTORY V2 NIGHT RUN START"
  log "Project: $PROJECT_DIR"
  log "Tasks file: $TASKS_FILE"
  log "Test command: $TEST_CMD"
  log "Max retries/task: $MAX_RETRIES"
  log "Max consecutive failures: $MAX_CONSEC_FAILS"

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

  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    log "ERROR: not inside a git repository"
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
  elif ! grep -q '^tests/acceptance/$' "$PROJECT_DIR/.aiderignore"; then
    echo "tests/acceptance/" >> "$PROJECT_DIR/.aiderignore"
    log "Added tests/acceptance/ to .aiderignore"
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
  tail -20 "$TEST_OUTPUT" | tee -a "$LOG_FILE" >/dev/null
  return 1
}

planning_phase() {
  local global_rules="$1"
  local planning_prompt
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

  log "Planning phase (Sonnet)"
  timeout 300 aider "${AIDER_ARGS[@]}" \
    --model "openrouter/anthropic/claude-sonnet-4" \
    --message "$planning_prompt" \
    --file "$TASKS_FILE" >> "$LOG_FILE" 2>&1 || log "Planning phase returned non-zero exit code"

  if [ -f "$PROJECT_DIR/plan.md" ]; then
    log "Plan created: plan.md"
  else
    log "Plan not created; continuing"
  fi

  log ""
}

run_task() {
  local task_name="$1"
  local task_body="$2"
  local global_rules="$3"
  local attempt=0
  local task_ok=false
  local safe_task_name

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
    attempt=$((attempt + 1))
    log "Attempt $attempt/$MAX_RETRIES"

    timeout 600 aider "${AIDER_ARGS[@]}" --message "$prompt" >> "$LOG_FILE" 2>&1 || true
    run_lint

    if run_tests; then
      task_ok=true
      break
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

  if [ "$task_ok" = true ]; then
    log "Completed: $safe_task_name"
    COMPLETED=$((COMPLETED + 1))
    CONSECUTIVE_FAILS=0
    git add -A
    git commit -m "feat: $safe_task_name [dev-factory]" --allow-empty >/dev/null 2>&1 || true
  else
    log "Failed: $safe_task_name"
    FAILED=$((FAILED + 1))
    CONSECUTIVE_FAILS=$((CONSECUTIVE_FAILS + 1))

    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      git stash push --include-untracked -m "dev-factory failed task: $safe_task_name" >/dev/null 2>&1 || true
      log "Stashed failed task changes"
    fi
  fi

  log ""
}

main() {
  preflight

  local global_rules
  global_rules="$(extract_global_rules)"

  planning_phase "$global_rules"

  local tasks=()
  while IFS= read -r task_line; do
    [ -n "$task_line" ] || continue
    tasks+=("$task_line")
  done < <(extract_task_names)

  local total="${#tasks[@]}"

  if [ "$total" -eq 0 ]; then
    log "No tasks found in tasks.md. Add headings like: ## Task 1: ..."
    exit 1
  fi

  log "Execution phase"
  log "Tasks found: $total"
  log ""

  local index=0
  for task_name in "${tasks[@]}"; do
    index=$((index + 1))

    if [ "$CONSECUTIVE_FAILS" -ge "$MAX_CONSEC_FAILS" ]; then
      SKIPPED=$((total - index + 1))
      log "Circuit breaker triggered ($CONSECUTIVE_FAILS consecutive failures)"
      break
    fi

    log "[$index/$total]"
    task_body="$(extract_task_body "$task_name")"
    run_task "$task_name" "$task_body" "$global_rules"
  done

  local end_ts
  end_ts="$(date +%s)"
  local duration_min=$(( (end_ts - START_TS) / 60 ))

  log "NIGHT RUN COMPLETE"
  log "Duration (minutes): $duration_min"
  log "Completed: $COMPLETED"
  log "Failed: $FAILED"
  log "Skipped: $SKIPPED"
  log "Recent commits:"
  git log --oneline -10 >> "$LOG_FILE" 2>/dev/null || true
}

main
