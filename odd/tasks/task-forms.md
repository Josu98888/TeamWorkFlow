# Task creation with a forms builder (TOP PRIORITY)

## Objective
Let an admin or supervisor create tasks and their report forms from the frontend, so employees can answer them (including photos uploaded to Supabase Storage) and the reports show up in "Tareas y Reportes".

## Problem and why
After the first deploy (2026-11-18) the user found there is no UI to create a task, so task photos and the Storage bucket could not be tested. The user had asked for this before the design work; it was classified as large future work and left out of the quick wins and the redesign. The user marked it as important (2026-11-19): it goes first after the redesign in progress.

## Scope
- In scope: forms for tasks and their reports.
- Out of scope: notifications (user decision, 2026-11-19).

## What is known
- Creating a task needs a form version (`formVersionId`); photos and reports are the employee's answers to that form.
- So the work is: forms builder (fields, field types including photo, versions) → task creation (template, site/post, schedule or frequency, form) → employee answering flow with photo upload → report view.
- Backend endpoints for forms and tasks may already exist in `backend/core/src/tasks/` (check `backend/core/src/tasks/AGENTS.md` and the task-templates controller) before planning any backend change.

## Tasks
- [x] F0 Map what the backend already supports (forms, versions, templates, task creation, answers, photo upload) and what the frontend lacks.
- [x] F1 Plan with the user: frontend only, use what the backend already has (no reports endpoint, no templates, no notifications). Employee answers from the web app.
- [x] F2 Forms (owner/admin): forms domain in `frontend/features/tasks/` (types, http, mock), list + builder (draft fields of every type, edit, publish). Route: delegated.
- [x] F3 Task creation (owner/admin/supervisor): create a task from a published form version (site, post, optional employee, deadline, title). Route: delegated.
- [x] F4 Employee answering in "Mi jornada": list own/claimable tasks, claim, render the form per field type, photo upload (`POST /media/uploads` → presigned PUT → answer with `mediaId`), submit. Route: delegated.

Checks per task: `pnpm lint` and `npx tsc --noEmit` in `frontend/` (no frontend test runner; TDD off). The user runs `pnpm build`. RDD: off (global).
Delivery: commits on `feat/frontend/main-pages` (unrelated uncommitted redesign files must not be staged). Strategy: ask-on-risk.

## F0 findings (2026-11-19)
- Backend already has everything needed except reports (all under `backend/core/src/tasks/`, plan feature `tasks`):
  - Forms: `POST/PATCH /forms`, `POST /forms/:id/publish` (immutable `FormVersion`), `GET /forms[/:id]` (owner/admin write).
  - Field types: `text`, `number`, `yes_no`, `select`, `checklist`, `photo`, `qr` (`domain/form-validator.ts`).
  - Templates (per shift, site/post): `POST/PATCH/GET /task-templates` (owner/admin). No frequency/cron: recurrence = each shift start.
  - Tasks: `POST /tasks` (owner/admin/supervisor; `formVersionId`, `deadline`, `siteId`, `postId`, `employeeId?`), `GET /tasks[/:id]`, `claim`, `answer`, `review` (`APPROVED`/`OBSERVED`).
  - Photos: `POST /media/uploads` → presigned PUT → answer with `mediaId`; `GET /media/:id/url`. Employee-only upload, 10 MB, jpeg/png/webp. Browser PUT needs bucket CORS.
  - Reports: no endpoint; frontend aggregates client-side from `GET /tasks` (`features/tasks/report.ts`).
- Frontend only calls `GET /tasks` (`features/tasks/http.ts`); everything else is missing (builder, templates, task create/detail/review, answer UI, media).

## Progress
- F0 done 2026-11-19 (read-only mapping, delegated).
- F2 done 2026-11-19 (delegated writer): forms list (`/tareas/formularios`), builder (`/nuevo`, `/[formId]`: add/remove/reorder fields, all 7 types, draft save, publish, versions panel), types, http and stateful mock. New capabilities `forms.manage`, `tasks.create`, `tasks.answer` in `shared/auth/permissions.ts`; route rule for `/tareas/formularios` (owner/admin). Checks: `pnpm lint` 0 errors (2 pre-existing warnings: `window.location.href` in dashboard layout and `useSession.ts`); `npx tsc --noEmit` clean. Commit d939100.
- F3 done 2026-11-19 (delegated writer): "Nueva tarea" modal in Tareas y Reportes (visible to owner/admin/supervisor via `tasks.create`): latest published version per form (list + `GET /forms/:id` per form), site, post, optional employee (employees of the site), deadline (must be future), optional title, optional expected QR only when the version has a `qr` field. `createTask` in api/http/mock; Spanish error copy in `features/tasks/errors.ts`. Checks: `pnpm lint` 0 errors (same 2 pre-existing warnings); `npx tsc --noEmit` clean. Commit 712a0fb.
- F4 done 2026-11-19 (delegated writer): "Mis tareas" section in Mi jornada (injected into `MyShiftView` via the `tasksSection` slot from the route so telemetry does not import tasks): pending assigned and claimable tasks, claim, answer modal rendering every field type, photo upload (sha256 via `crypto.subtle`, `POST /media/uploads`, PUT to `uploadUrl` with the declared content type, `mediaId` as answer; client-side 10 MB and jpeg/png/webp checks), QR input with camera scanner (`QrScanner` now exported by the telemetry index), `clientAnswerId` generated once per opened form, Spanish copy for backend error codes. Mock: stateful, demo employee = employee 2. Checks: `pnpm lint` 0 errors (same 2 pre-existing warnings); `npx tsc --noEmit` clean. Commit 8220114.
