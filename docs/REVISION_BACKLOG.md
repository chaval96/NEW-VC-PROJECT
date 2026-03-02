# Revision Backlog

Use this file as the source of truth for nightly execution planning.

Queue format:
- [ ] P{0-3} | Task title | Implementation details | Acceptance target

## Global Rules
- Do not modify `tests/acceptance/` during autonomous runs.
- If tests fail, fix implementation not acceptance tests.
- Keep changes scoped and reversible.

## Queue
- [ ] P0 | Restore clean API middleware wiring | Remove duplicated imports/declarations in `server/index.ts`, keep single global+auth rate limit setup and single validation middleware chain | `npm run typecheck` passes without `server/index.ts` duplicate errors
- [ ] P0 | Add API route integration tests | Add `tests/acceptance/auth-rate-limit.test.ts` and `tests/acceptance/workspace-validation.test.ts` with behavior assertions | `npm test` includes new route-level coverage
- [ ] P1 | Formalize run health checks | Add `scripts/system_health_check.sh` to validate env, dependencies, tmux, and git readiness before starting run | Running script returns non-zero on misconfigurations
- [ ] P1 | Strengthen run observability | Append per-task elapsed time and failure categories in `scripts/run_night.sh` logs | Night log includes timing + categorized failures
- [ ] P1 | Add CI quality gate | Add GitHub Actions workflow for typecheck + test on PRs/main | CI workflow runs on push and pull_request
- [ ] P2 | Improve operations dashboard confidence signals | Surface stale runs and blocked submissions in dashboard API/UX | Dashboard shows stale/blocked counters
- [ ] P2 | Harden secrets and config docs | Add env validation matrix and secret rotation guide under `docs/` | Operators can bootstrap without guesswork
