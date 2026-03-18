# Hallyx Workflow Engine

<p align="center">
  <img src="frontend/logo.png" alt="Halleyx Logo" width="110" />
</p>

<p align="center"><b>Workflow orchestration platform with role-based operations, rule routing, execution control, and audit visibility.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20%2B-2f855a?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-Backend-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-SQLite-1f2937?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma SQLite" />
  <img src="https://img.shields.io/badge/Status-Active-16a34a?style=for-the-badge" alt="Status Active" />
</p>

## Overview

Hallyx is a full-stack workflow engine that lets teams design workflows, define step routing rules, execute flows, pause at approvals, and track complete audit logs from one dashboard.

### Why this project stands out

- Workflow CRUD + Step CRUD + Rule CRUD are fully implemented
- Rule engine supports priority evaluation with `DEFAULT` fallback
- Execution lifecycle includes `in_progress`, `pending_approval`, `completed`, `failed`, `canceled`
- Role-based operations split employee and manager responsibilities
- Audit-friendly execution logs capture step-level behavior and outcomes

## Role-Based Access

Demo users:

- Employee: `employee` / `employee123`
- Manager: `manager` / `manager123`

Permissions:

- Employee: start workflow execution, view status/logs
- Manager: approve/reject/cancel/retry execution, view status/logs

## Architecture Snapshot

```text
Frontend (Vanilla JS UI)
	|
	v
Express API (backend/src/server.ts)
	|
	v
Prisma ORM
	|
	v
SQLite (backend/prisma/dev.db)
```

Core folders:

- `backend/src/server.ts` → API + execution orchestration
- `backend/src/lib/ruleEngine.ts` → condition validation/evaluation
- `backend/prisma/schema.prisma` → data models
- `frontend/` → dashboard UI
- `doc/END_TO_END_HANDOFF.md` → complete project handoff notes

## Quick Start

Run from workspace root:

```powershell
npm --prefix backend install
cd backend
npx prisma generate
npx prisma migrate dev --name sync
npm run dev
```

Open:

- `http://localhost:3000/` → UI dashboard
- `http://localhost:3000/health` → health check

## API Coverage

- Workflows: create/list/get/update/delete
- Steps: create/list/update/delete
- Rules: create/list/update/delete
- Execution: execute/list/get/cancel/retry/approve/reject/summary
- Auth (demo): login/me/logout

## Demo Flow (Interview-Ready)

1. Login as manager and create workflow + steps + rules.
2. Logout and login as employee.
3. Start execution with sample payload.
4. Show pending approval state.
5. Login as manager and approve/reject.
6. Open audit logs and summary for traceability.

## Verification

Backend checks:

```powershell
cd backend
npm run build
npm test
```

Expected:

- TypeScript build passes
- Rule engine tests pass

## Project Notes

- Source of truth code is TypeScript under `backend/src/**/*.ts`.
- Generated JavaScript and declaration artifacts can exist alongside TS build workflow.
- Media assets (for example `Video/`, `Company Logo/`) are excluded via `.gitignore`.


Demo Video:
https://drive.google.com/file/d/1sVZFTJeeB7TKMFWG8uzHWp7insbygSXP/view?usp=sharing

