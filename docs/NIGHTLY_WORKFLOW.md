# Nightly Workflow

## Evening
1. Update backlog priorities in `docs/REVISION_BACKLOG.md`.
2. Validate backlog scope before generation:
   - `bash scripts/validate_backlog_scope.sh`
3. Generate `tasks.md` from backlog:
   - `bash scripts/sync_tasks_from_backlog.sh`
4. Add/refresh acceptance tests in `tests/acceptance/`.
5. Start automation:
   - `bash scripts/start_night.sh`

## Overnight (Strict Finalized Mode)
- Planner: enabled by default (`DEV_FACTORY_ENABLE_PLANNING=true`) with local fallback plan generation.
- Coder: Aider runs task attempts with per-task timeout.
- Test gate: wrapper runs lint/test after each attempt.
- Review gate: `scripts/review_gate.py` must return `PASS` before task completion.
- API reliability: reviewer API calls include retry/backoff before deciding pass/fail to reduce transient outages.
- Budget guard: `scripts/openrouter_budget_guard.py` checks OpenRouter key budget and can stop run.
- Budget reliability: budget endpoint checks include retry/backoff; checks are metadata calls (not model token generation).
- Completion gate: only after test + review pass does runner commit and mark backlog item as done.
- Run-until-morning mode: when `DEV_FACTORY_RUN_UNTIL_MORNING=true`, runner keeps refreshing tasks from backlog in waves until cutoff.

## Morning
1. Run summary:
   - `bash scripts/morning_review.sh`
2. Read consolidated report:
   - `logs/reports/night-shift-report.md`
3. Inspect diff + test status.
4. Merge or revise backlog priorities.

## Recommended Guardrail Env
- `DEV_FACTORY_REVIEW_GATE_ENABLED=true`
- `DEV_FACTORY_REVIEW_MODEL=anthropic/claude-sonnet-4`
- `DEV_FACTORY_REVIEW_MAX_DIFF_CHARS=24000`
- `DEV_FACTORY_REVIEW_FAIL_OPEN_ON_API_ERROR=false`
- `DEV_FACTORY_REVIEW_API_RETRIES=2`
- `DEV_FACTORY_REVIEW_API_RETRY_DELAY_SECONDS=2`
- `DEV_FACTORY_REVIEW_API_TIMEOUT_SECONDS=45`
- `DEV_FACTORY_BUDGET_GUARD_ENABLED=true`
- `DEV_FACTORY_MIN_REMAINING_USD=1.00`
- `DEV_FACTORY_MAX_NIGHT_USAGE_USD=1.50`
- `DEV_FACTORY_BUDGET_CHECK_INTERVAL_SECONDS=60`
- `DEV_FACTORY_BUDGET_FAIL_OPEN=false`
- `DEV_FACTORY_BUDGET_API_RETRIES=3`
- `DEV_FACTORY_BUDGET_API_RETRY_DELAY_SECONDS=2`
- `DEV_FACTORY_BUDGET_API_TIMEOUT_SECONDS=20`
- `DEV_FACTORY_MAX_TOTAL_ITERATIONS=120`
- `MAX_NIGHTLY_TASKS=6`
- `DEV_FACTORY_RUN_UNTIL_MORNING=true`
- `DEV_FACTORY_RUN_UNTIL_LOCAL_HHMM=08:00`
- `DEV_FACTORY_RUN_UNTIL_TZ=Europe/Madrid`

## Principle
Roadmap -> VC-scope backlog guard -> tasks.md -> Nightly run -> Morning human approval.
