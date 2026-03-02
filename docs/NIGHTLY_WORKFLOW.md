# Nightly Workflow

## Evening
1. Update backlog priorities in `docs/REVISION_BACKLOG.md`.
2. Generate `tasks.md` from backlog:
   - `bash scripts/sync_tasks_from_backlog.sh`
3. Add/refresh acceptance tests in `tests/acceptance/`.
4. Start automation:
   - `bash scripts/start_night.sh`

## Morning
1. Run summary:
   - `bash scripts/morning_review.sh`
2. Inspect diff + test status.
3. Merge or revise backlog priorities.

## Principle
Roadmap -> Backlog -> tasks.md -> Nightly run.
