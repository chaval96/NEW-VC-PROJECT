# VCReach FormOps

Project-based web app for startup fundraising teams to automate VC website-form outreach with AI agents, while keeping human approval and full tracking.

## Product scope (v1)

- Signup + login with email verification
- Multi-project workspace model (one account can manage multiple startup raises)
- Company knowledge base per project (company, metrics, fundraising, contact profile)
- Investor import (CSV/XLSX and Google Drive)
- Agent processing runs (`dry_run` or `production`)
- Human approval queue before final submission
- Visual dashboard for funnel, trend, pipeline, and activity logs

## Main app routes

- `/login` (login + signup)
- `/verify-email?token=...` (email verification)
- `/projects`
- `/projects/:workspaceId/onboarding`
- `/projects/:workspaceId/dashboard`

## Backend architecture

- Express API + Vite React frontend
- `StateStore` for operational campaign data
- `AuthService` for users, sessions, verification tokens, and workspace memberships
- `CampaignOrchestrator` + agents for form workflow execution

## Database structure

Production auth/access tables are defined in:

- `server/db/schema.sql`

Tables:

- `users`
- `email_verification_tokens`
- `auth_sessions`
- `workspace_memberships`
- `audit_logs`
- `projects`
- `investors`
- `investor_import_batches`
- `processing_runs`
- `submission_requests_operational`
- `submission_events_operational`

These are initialized automatically on server boot when `DATABASE_URL` is set.

## Environment variables

Required:

- `DATABASE_URL`
- `NODE_ENV=production`
- `DATABASE_SSL=require`
- `CORS_ORIGIN=*` (tighten for production)
- `APP_BASE_URL` (used in verification links)

Recommended:

- `AUTH_EMAIL`
- `AUTH_PASSWORD`
- `AUTH_NAME`

Optional (real verification emails):

- `RESEND_API_KEY`
- `EMAIL_FROM`

Optional (browser automation):

- `PLAYWRIGHT_ENABLED=true`
- `PLAYWRIGHT_SUBMIT_ENABLED=true`

Optional feature flags (disabled by default for lower cost):

- `FEATURE_CREDITS=true`
- `FEATURE_ASSESSMENT=true`

## Local development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## API highlights

Auth:

- `POST /api/auth/signup`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Workspace + operations:

- `GET /api/workspaces`
- `POST /api/workspaces`
- `POST /api/workspaces/:id/activate`
- `PATCH /api/workspaces/:id/profile`
- `GET /api/dashboard/overview?workspaceId=...`
- `GET /api/firms?workspaceId=...`
- `POST /api/firms/import-file?workspaceId=...`
- `POST /api/firms/import-drive?workspaceId=...`
- `GET /api/submissions/queue?workspaceId=...`
- `POST /api/submissions/:id/approve?workspaceId=...`
- `POST /api/submissions/:id/reject?workspaceId=...`
- `POST /api/runs` (body includes `workspaceId`)

Optional endpoints (only when feature flags are enabled):

- `/api/credits/*`
- `/api/assess*`

## Deploy checklist (Railway)

1. Push latest commit to `main`.
2. Confirm service source points to this repo/branch.
3. Set required env vars.
4. Deploy and verify:
   - `/api/health`
   - signup
   - email verification
   - login
   - project creation/open
   - investor import
   - processing run
   - approval queue actions
