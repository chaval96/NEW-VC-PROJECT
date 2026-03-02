# VCReach Roadmap

Last Updated: 2026-03-02
Owner: Product + Engineering

## Product North Star
Build a clean, reliable, and measurable VC outreach operations platform where teams can import leads, run AI-assisted workflows, approve submissions safely, and track execution evidence end-to-end.

## Phase 1: Foundation Hardening (Current)
Status: In Progress

Goals:
- Restore compile health and remove duplicate middleware wiring.
- Lock API input validation and security defaults.
- Establish planning + backlog discipline for nightly automation.

Deliverables:
- Typecheck green (`npm run typecheck`).
- Canonical rate limiting and validation middleware in `server/index.ts`.
- `docs/BLUEPRINT.md`, `docs/REVISION_BACKLOG.md`, and task sync script in place.

## Phase 2: Core Workflow Reliability
Status: Planned

Goals:
- Make run orchestration deterministic and auditable.
- Improve failure recovery for submission and agent tasks.

Deliverables:
- Retry/idempotency policy documented and implemented.
- Better run-level telemetry and error categorization.
- Acceptance tests for run execution, queue transitions, and approval paths.

## Phase 3: Product Completeness
Status: Planned

Goals:
- Complete project onboarding + dashboard + operations UX loops.
- Ensure import -> run -> approval -> submission -> evidence loop is production-ready.

Deliverables:
- Coverage for onboarding edge cases.
- Operational alerts and stale-run detection surfaced in UI.
- Documentation for operator playbooks.

## Phase 4: Production Readiness
Status: Planned

Goals:
- Deploy predictably with observability, security, and rollback playbooks.

Deliverables:
- Release checklist + rollback runbook.
- Structured logs/metrics dashboard and alert thresholds.
- Security baseline review and secrets hygiene.

## Execution Rules
- Nightly automation executes from `tasks.md` only.
- `tasks.md` should be generated from `docs/REVISION_BACKLOG.md` before each run.
- Every backlog item must include an acceptance target.
