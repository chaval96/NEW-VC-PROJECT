# Night Run Tasks

## GLOBAL RULES
- This is a TypeScript project with Express backend and Vite React frontend.
- Files in tests/acceptance/ are READ-ONLY. Never modify them.
- If an acceptance test fails, fix the CODE not the test.
- Use behavioral assertions (avoid brittle exact timestamps/UUIDs).
- Keep functions focused and changes minimal.

## Task 1: Restore clean API middleware wiring
Priority: P0
- Remove duplicated imports/declarations in `server/index.ts`, keep single global+auth rate limit setup and single validation middleware chain
- Acceptance: `npm run typecheck` passes without `server/index.ts` duplicate errors

## Task 2: Add API route integration tests
Priority: P0
- Add `tests/acceptance/auth-rate-limit.test.ts` and `tests/acceptance/workspace-validation.test.ts` with behavior assertions
- Acceptance: `npm test` includes new route-level coverage

## Task 3: Formalize run health checks
Priority: P1
- Add `scripts/system_health_check.sh` to validate env, dependencies, tmux, and git readiness before starting run
- Acceptance: Running script returns non-zero on misconfigurations
