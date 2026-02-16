# Fundraising Operations Hub

Multi-company internal web app for VC website-form outreach.

## Core capabilities

- Multiple fundraising projects/workspaces (not WASK-only)
- Per-workspace company profile and fundraising metadata
- CSV investor import (append/replace)
- Agent orchestration pipeline for form operations
- Human approval queue before final submission
- Playwright-ready execution hook for real website form automation
- Dashboard metrics and audit logs

## Current workflow

1. Create/select workspace (company fundraising project)
2. Update company profile
3. Import investor list via CSV
4. Run orchestration (`dry_run` or `production`)
5. Review `pending_approval` queue
6. Approve/reject one by one

## Local development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Railway deploy

### Variables

Required:

- `DATABASE_URL` (reference to Railway Postgres)
- `NODE_ENV=production`
- `DATABASE_SSL=require`
- `CORS_ORIGIN=*` (set to real domain later)

Optional for real browser automation:

- `PLAYWRIGHT_ENABLED=true`
- `PLAYWRIGHT_SUBMIT_ENABLED=true`

### Build

- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Root directory: repo root

`railway.json` already forces Dockerfile build.

## CSV format

At minimum, include columns:

- `name` (or `company` / `firm`)
- `website` (or `domain` / `url`)

Optional columns:

- `location`
- `investor_type`
- `check_size_range`
- `focus_sectors` (comma or semicolon separated)

## API highlights

- `GET /api/workspaces`
- `POST /api/workspaces`
- `POST /api/workspaces/:id/activate`
- `PATCH /api/workspaces/:id/profile`
- `POST /api/firms/import-csv`
- `GET /api/submissions/queue`
- `POST /api/submissions/:id/approve`
- `POST /api/submissions/:id/reject`
- `POST /api/runs`

## How to deploy updates (every time)

1. Commit and push code from GitHub Desktop
2. Railway auto-deploys from connected repo
3. Open latest deployment logs
4. Validate:
   - `/api/health`
   - workspace switch
   - CSV import
   - run creation
   - queue approve/reject

## Real submission automation notes

`SubmissionExecutor` supports Playwright through dynamic import. If Playwright is not installed or enabled, it safely falls back to simulation.
For full real execution in production, install Playwright and enable both Playwright env vars.
