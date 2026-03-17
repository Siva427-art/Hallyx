# Hallyx Full Stack Engineer Challenge - End-to-End Handoff (Live Status)

Updated: 2026-03-16

## 1) Goal
Build a workflow engine platform with CRUD, rule-based routing, execution tracking, logs, and minimal UI.

Core objective for interview: correctness + explainability.

---

## 2) What Is Completed So Far

### Project Setup
- Created backend project in `backend`
- Installed runtime + dev dependencies
- Added scripts in `backend/package.json`:
  - `dev`
  - `build`
  - `start`

### Prisma + Database
- Initialized Prisma in `backend`
- Created workflow schema in `backend/prisma/schema.prisma`
- Resolved Prisma v7 config mismatch by moving to stable Prisma v6.14.0
  - `prisma@6.14.0`
  - `@prisma/client@6.14.0`
- Switched datasource to SQLite for local stability:
  - provider: `sqlite`
  - `DATABASE_URL="file:./dev.db"`
- Reset old migration history (postgres -> sqlite mismatch)
- Created fresh migration:
  - `backend/prisma/migrations/20260314010949_init_workflow`
- Added and migrated Step model:
  - `backend/prisma/migrations/20260314185551_add_step_model`
- Added and migrated Rule model:
  - `backend/prisma/migrations/20260314185839_add_rule_model`
- Added and migrated Execution models:
  - `backend/prisma/migrations/20260314190309_add_execution_models`

### Backend Runtime
- Created Prisma client helper:
  - `backend/src/lib/prisma.ts`
- Created server file:
  - `backend/src/server.ts`
- Added working routes:
  - `GET /` -> serves UI (`frontend/index.html`)
  - `GET /health` -> JSON health response
  - `POST /workflows` -> creates workflow in DB
  - `GET /workflows`
  - `GET /workflows/:id`
  - `PUT /workflows/:id` (version increment)
  - `DELETE /workflows/:id`
  - `POST /workflows/:workflowId/steps`
  - `GET /workflows/:workflowId/steps`
  - `PUT /steps/:id`
  - `DELETE /steps/:id`
  - `POST /steps/:stepId/rules`
  - `GET /steps/:stepId/rules`
  - `PUT /rules/:id`
  - `DELETE /rules/:id`
  - `POST /workflows/:workflowId/execute`
  - `GET /executions`
  - `GET /executions/:id`
  - `POST /executions/:id/cancel`
  - `POST /executions/:id/retry`

### Frontend/UI
- Added static UI served by backend from `frontend`
  - `frontend/index.html`
  - `frontend/styles.css`
  - `frontend/app.js`
- Implemented UI sections:
  - Workflow list table with search, filter, pagination, edit, execute actions
  - Workflow editor with workflow detail, schema editing, create/update/delete
  - Step editor + list with inline edit/delete
  - Rule editor with list, add/edit/delete, syntax validation, drag-drop priority reorder
  - Execute workflow + status/cancel/retry
  - Audit execution list
  - Execution progress panel (current step, status, retries, required action)
  - Execution logs panel with step-wise evaluated rules and duration details

### Final Submission Artifacts
- Added root README:
  - `README.md`
- Added sample workflow data:
  - `doc/sample-workflows.json`
- Added demo walkthrough:
  - `doc/DEMO_SCRIPT.md`

---

## 3) Current Actual File State (Important)

### `backend/prisma/schema.prisma`
- Models available:
  - `Workflow`
  - `Step`
  - `Rule`
  - `Execution`
  - `ExecutionLog`
- Enums available:
  - `StepType`
  - `ExecutionStatus`

### `backend/src/server.ts`
- Express + CORS + JSON middleware configured
- Health route and root route present
- Serves static frontend from `frontend`
- Workflow CRUD done
- Step CRUD done
- Rule CRUD done
- Execution APIs done (execute/status/cancel/retry)
- Basic rule evaluation + DEFAULT fallback + step logs implemented
- Basic payload validation added
- Common JSON error response helper added
- Workflow list now supports `search`, `page`, and `limit`
- Execution input data is validated against workflow `inputSchema`
- Invalid rule syntax now explicitly fails the step and logs the error

### `backend/src/lib/prisma.ts`
- Uses `@prisma/client`

---

## 4) Problems Faced and Fixed
- `Cannot find module '../../generated/prisma'` -> fixed by using `@prisma/client`
- `require/process/module not found` in TS -> fixed by `types: ["node"]` in `backend/tsconfig.json`
- `PrismaClientInitializationError` + datasource mismatch -> fixed by moving to Prisma v6 + SQLite URL + fresh migration
- `Cannot GET /` confusion -> handled by adding `GET /`

---

## 5) Remaining Work (Priority Order)

### Backend (Do Next)
1. Refactor `server.ts` into modules (`routes/services`)
2. Add automated tests if time permits
3. Optional: improve UI styling further

### Data Models (After Workflow CRUD)
6. Add `Step` model + migrations (done)
7. Add `Rule` model + migrations (done)
8. Add `Execution` + `ExecutionLog` models (done)

### APIs After Models
9. Step CRUD endpoints (done)
10. Rule CRUD endpoints (done)
11. Execute endpoint (`POST /workflows/:workflow_id/execute`) (done)
12. Execution detail/cancel/retry endpoints (done)

### Frontend (Final Phase)
13. Workflow list page (done)
14. Workflow editor (done - minimal)
15. Rule editor (done - minimal)
16. Execution view (done - minimal)
17. Audit log page (done - minimal)

---

## 6) Next Session Quick Start Commands
Run from workspace root:

```powershell
npm --prefix backend install
cd backend
npx prisma generate
npx prisma migrate dev --name sync
npm run dev
```

Then test:
- `http://localhost:3000/` (UI should open)
- `http://localhost:3000/health`

---

## 7) API Contract Target (Still Required)

### Workflows
- POST `/workflows` (done)
- GET `/workflows` (done)
- GET `/workflows/:id` (done)
- PUT `/workflows/:id` (done)
- DELETE `/workflows/:id` (done)

### Steps
- POST `/workflows/:workflow_id/steps` (done)
- GET `/workflows/:workflow_id/steps` (done)
- PUT `/steps/:id` (done)
- DELETE `/steps/:id` (done)

### Rules
- POST `/steps/:step_id/rules` (done)
- GET `/steps/:step_id/rules` (done)
- PUT `/rules/:id` (done)
- DELETE `/rules/:id` (done)

### Execution
- POST `/workflows/:workflow_id/execute` (done)
- GET `/executions` (done)
- GET `/executions/:id` (done)
- POST `/executions/:id/cancel` (done)
- POST `/executions/:id/retry` (done)

---

## 8) New Chat Continuity Prompt (Pre-Filled)
Copy-paste this in a new chat:

```txt
I am building the Hallyx workflow engine challenge. Continue from this exact state.

Completed:
- Backend setup done (Express + TS + Prisma)
- Prisma downgraded to v6.14.0 for stable local workflow
- SQLite datasource configured
- Workflow, Step, Rule, Execution models created and migrated
- Server routes working: workflow/step/rule CRUD + execution APIs
- Frontend UI pages added under frontend and served at /

Current files:
- backend/src/server.ts
- backend/src/lib/prisma.ts
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260314010949_init_workflow
- backend/prisma/migrations/20260314185551_add_step_model
- backend/prisma/migrations/20260314185839_add_rule_model
- backend/prisma/migrations/20260314190309_add_execution_models

Pending now:
- Small refactor only (optional)

Constraints:
- 3-day MVP
- Simple code I can explain in interview
- No over-engineering

Please give me the next exact coding step and explain each line in simple terms.
```

---

## 9) Interview Honesty Strategy
- Do not claim zero AI usage.
- Safe statement:
  - “I used AI for guidance/review. Architecture decisions, coding, debugging, and final understanding are mine.”

---

## 10) Final Submission Checklist (Target)
- Backend CRUD + execution APIs done
- Rule engine behavior (priority + DEFAULT) done
- Retry/cancel behavior done
- UI required screens done
- README with setup + architecture + sample workflow + sample logs
- 3–5 minute demo flow prepared
