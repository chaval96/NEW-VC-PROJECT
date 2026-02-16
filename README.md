# WASK VC FormOps App

Internal VC outreach operations app focused on website form submissions (no separate email outreach).

## What this app includes

- Apollo-style internal dashboard for form operations
- VC target tracking with filters (location, investor type, check size, focus sectors)
- Agent orchestration pipeline for form workflows
- Run/task/log auditing for each orchestration
- Postgres persistence support for production
- Railway Docker deployment config

## Agent pipeline (form only)

1. `FormDiscoveryAgent`
2. `QualificationAgent`
3. `FormMappingAgent`
4. `QAAgent`
5. `SubmissionAgent`
6. `TrackingAgent`

## Local development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Railway deployment

### Required app variables

- `DATABASE_URL` (Railway Postgres reference)
- `NODE_ENV=production`
- `DATABASE_SSL=require`
- `CORS_ORIGIN=*` (temporary)
- `PORT` optional on Railway (platform sets this automatically)

### Railway build/deploy

- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Root directory: repo root

`railway.json` is included to force Docker builder.

## API endpoints

- `GET /api/health`
- `GET /api/dashboard/overview`
- `GET /api/profile`
- `GET /api/playbook`
- `GET /api/firms`
- `GET /api/firms/:id`
- `PATCH /api/firms/:id/stage`
- `GET /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs`

## Notes

- Current `production` mode provides deterministic simulation for statuses.
- To perform actual autonomous browser form submissions, integrate Playwright worker execution into `SubmissionAgent`.
