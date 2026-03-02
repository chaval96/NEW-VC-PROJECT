# Night Run Tasks

## GLOBAL RULES
- This is a TypeScript project with Express backend and Vite React frontend.
- Files in tests/acceptance/ are READ-ONLY. Never modify them.
- If an acceptance test fails, fix the CODE not the test.
- Use behavioral assertions (avoid brittle exact timestamps/UUIDs).
- Keep functions focused and changes minimal.

## Task 1: Enforce submission state-machine transitions
Priority: P0
- In `server/index.ts`, centralize and enforce valid transition guards for approve/reject/bulk-approve/watchdog paths so invalid status jumps return deterministic `409` responses and do not mutate state
- Acceptance: Approve/reject endpoints reject invalid transitions consistently and `npm test` stays green

## Task 2: Make submission execution idempotent under concurrent actions
Priority: P0
- In `server/index.ts`, ensure duplicate approve/retry triggers for the same request cannot create duplicate execution attempts/events; return stable response when request is already executing
- Acceptance: Concurrent or repeated actions on one request produce a single execution path and `npm test` stays green

## Task 3: Strengthen approval queue contract for operators
Priority: P0
- Extend `/api/submissions/queue` to support deterministic sort/filter metadata (status, age, retry/stale hints) so dashboard and operators can reliably triage
- Acceptance: Queue response includes actionable status/age fields and preserves deterministic ordering
