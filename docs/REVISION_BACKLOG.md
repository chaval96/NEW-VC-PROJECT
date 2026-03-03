# Revision Backlog

Use this file as the source of truth for nightly execution planning.

Queue format:
- [ ] P{0-3} | Task title | Implementation details | Acceptance target

## Global Rules
- Nightly automation must prioritize VC product flow reliability: import -> research -> queue -> approval -> execution -> evidence -> dashboard.
- Do not modify `tests/acceptance/` during autonomous runs.
- If tests fail, fix implementation not acceptance tests.
- Keep changes scoped, reversible, and mapped to real product modules.

## Queue
- [x] P0 | Enforce submission state-machine transitions | In `server/index.ts`, centralize and enforce valid transition guards for approve/reject/bulk-approve/watchdog paths so invalid status jumps return deterministic `409` responses and do not mutate state | Approve/reject endpoints reject invalid transitions consistently and `npm test` stays green | Completed: 2026-03-03T20:31:10Z
- [ ] P0 | Make submission execution idempotent under concurrent actions | In `server/index.ts`, ensure duplicate approve/retry triggers for the same request cannot create duplicate execution attempts/events; return stable response when request is already executing | Concurrent or repeated actions on one request produce a single execution path and `npm test` stays green
- [ ] P0 | Strengthen approval queue contract for operators | Extend `/api/submissions/queue` to support deterministic sort/filter metadata (status, age, retry/stale hints) so dashboard and operators can reliably triage | Queue response includes actionable status/age fields and preserves deterministic ordering
- [ ] P1 | Improve execution evidence traceability | Ensure submission detail and evidence routes expose proof metadata (`proofLevel`, capture timestamp, screenshot availability) consistently for UI and audits | `/api/submissions/:id` and evidence endpoint return consistent proof metadata without regressions
- [ ] P1 | Prevent duplicate firm imports across repeated list uploads | Harden import merge path using normalized identity keys so repeated CSV/XLS imports do not inflate pipeline duplicates in a workspace | Importing the same list twice does not create duplicate firms for the same normalized identity
- [ ] P1 | Add watchdog workflow audit logs for retry/failure recovery | In submission workflow recovery, when watchdog moves requests from `executing` -> `pending_retry`/`failed`, append explicit run logs and result notes for operator forensics | Stale execution recovery events are visible in logs and request `resultNote`, aligned with approval queue workflow
- [ ] P2 | Expand dashboard confidence signals | Surface queue health summary (pending approvals, retries, stale executions, failed last-24h) in analytics payload for operations UI | Dashboard API includes queue confidence counters aligned with ops triage workflow
- [ ] P2 | Publish operator runbook for approval and retry playbooks | Update docs with concrete operational procedures for approve/reject, retry handling, stale execution recovery, and evidence verification | Operators can run nightly + morning review without ad-hoc decisions
