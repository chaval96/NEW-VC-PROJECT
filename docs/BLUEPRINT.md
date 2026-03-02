# VCReach Blueprint

## 1) Platform Shape
- Frontend: React + Vite (`src/`)
- Backend: Express API (`server/`)
- Shared types: `shared/`
- Persistence/auth: Postgres + local fallback in `AuthService`
- Workflow engine: `server/orchestrator/workflow.ts`

## 2) Core Domain Capabilities
- Authentication and workspace membership.
- Workspace onboarding and company profile management.
- Investor import pipeline.
- Campaign run orchestration with agent stages.
- Human approval queue before submission.
- Submission execution with evidence capture.
- Analytics and operational visibility.

## 3) Clean Architecture Boundaries
- `server/domain/*`: pure domain entities and store behavior.
- `server/services/*`: external integrations and side effects.
- `server/orchestrator/*`: workflow policies and task execution ordering.
- `server/index.ts`: transport layer only (routes, auth guards, input validation).

## 4) Quality Gates
- Build gate: `npm run typecheck` must pass.
- Test gate: `npm test` must pass.
- API gate: all mutating routes have validation + auth checks.
- Ops gate: nightly run must produce deterministic logs and summary.

## 5) Non-Functional Priorities
- Reliability first over feature volume.
- Observability for every workflow transition.
- Idempotent retry behavior for external actions.
- Minimal secrets surface and strict env validation.
