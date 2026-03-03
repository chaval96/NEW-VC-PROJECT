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

## Task 4: Improve execution evidence traceability
Priority: P1
- Ensure submission detail and evidence routes expose proof metadata (`proofLevel`, capture timestamp, screenshot availability) consistently for UI and audits
- Acceptance: `/api/submissions/:id` and evidence endpoint return consistent proof metadata without regressions

## Task 5: Prevent duplicate firm imports across repeated list uploads
Priority: P1
- Harden import merge path using normalized identity keys so repeated CSV/XLS imports do not inflate pipeline duplicates in a workspace
- Acceptance: Importing the same list twice does not create duplicate firms for the same normalized identity

## Task 6: Add watchdog workflow audit logs for retry/failure recovery
Priority: P1
- In submission workflow recovery, when watchdog moves requests from `executing` -> `pending_retry`/`failed`, append explicit run logs and result notes for operator forensics
- Acceptance: Stale execution recovery events are visible in logs and request `resultNote`, aligned with approval queue workflow
