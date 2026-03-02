# Architecture
- `server/index.ts` exposes API routes and transport-level middleware.
- `server/orchestrator/workflow.ts` manages campaign run lifecycle.
- `server/domain/*` stores and transforms core entities.
- `server/services/*` encapsulates infrastructure and side effects.
- `src/*` provides operator UI pages and components.
