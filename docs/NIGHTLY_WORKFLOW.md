# Nightly Workflow

## Evening
1. Update backlog priorities in `docs/REVISION_BACKLOG.md`.
2. Generate `tasks.md` from backlog:
   - `bash scripts/sync_tasks_from_backlog.sh`
3. Add/refresh acceptance tests in `tests/acceptance/`.
4. Start automation:
   - `bash scripts/start_night.sh`

## Overnight (Strict Finalized Mode)
- Planner: enabled by default (`DEV_FACTORY_ENABLE_PLANNING=true`) with local fallback plan generation.
- Coder: Aider runs task attempts with per-task timeout.
- Test gate: wrapper runs lint/test after each attempt.
- Review gate: `scripts/review_gate.py` must return `PASS` before task completion.
- Budget guard: `scripts/openrouter_budget_guard.py` checks OpenRouter key budget and can stop run.
- Completion gate: only after test + review pass does runner commit and mark backlog item as done.

## Morning
1. Run summary:
   - `bash scripts/morning_review.sh`
2. Inspect diff + test status.
3. Merge or revise backlog priorities.

## Recommended Guardrail Env
- `DEV_FACTORY_REVIEW_GATE_ENABLED=true`
- `DEV_FACTORY_REVIEW_MODEL=openrouter/anthropic/claude-sonnet-4`
- `DEV_FACTORY_BUDGET_GUARD_ENABLED=true`
- `DEV_FACTORY_MIN_REMAINING_USD=1.00`
- `DEV_FACTORY_MAX_TOTAL_ITERATIONS=50`

## Principle
Roadmap -> Backlog -> tasks.md -> Nightly run -> Morning human approval.
