# Night Run Tasks

## GLOBAL RULES
- This is a TypeScript project with Express backend and Vite React frontend.
- Files in tests/acceptance/ are READ-ONLY. Never modify them.
- If an acceptance test fails, fix the CODE not the test.
- Use behavioral assertions: test shape, type, behavior — never exact values.
- Never assert exact dates, timestamps, or UUIDs.
- Use ES module imports (import/export).
- Backend code goes in server/. Frontend code goes in src/.
- Keep functions under 40 lines. Extract helpers when needed.

## Task 1: Add API Rate Limiting
Add express-rate-limit middleware to server/index.ts.
- Install express-rate-limit package.
- Apply a global rate limit: 100 requests per 15 minutes per IP.
- Apply a stricter limit on auth routes: 10 requests per 15 minutes.
- Return 429 with { error: "Too many requests" } when exceeded.
- Acceptance tests: tests/acceptance/ratelimit.test.ts

## Task 2: Add Input Sanitization
Add input sanitization to all POST endpoints.
- Install express-validator package.
- Add validation middleware for /api/auth/signup (email format, password min 8 chars).
- Add validation middleware for /api/workspaces (name required, max 100 chars).
- Return 400 with { errors: [...] } array on validation failure.
- Acceptance tests: tests/acceptance/validation.test.ts
