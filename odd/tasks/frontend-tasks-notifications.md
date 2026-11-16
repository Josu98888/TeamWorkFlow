# Frontend tasks and notifications integration, config and docs sync

## Objective

Connect the frontend Tasks screen to the real `core` tasks API, add in-app notifications to the frontend, add `frontend/.env.example`, and sync stale status docs with the code now on `develop`.

## Problem / why

`tasks` and `notifications` were merged into `develop` (PR #20), but the frontend Tasks screen is always mocked (`frontend/features/tasks/api.ts:11`) and notifications have no frontend at all. Status docs (root `AGENTS.md`, `STEPS.index.md`, `backend/core/AGENTS.md`, `README.md`, skills' Project Status) still say most modules are docs only.

## Scope

- In: tasks HTTP client + `USE_MOCKS` switch for the existing Tasks screen; notifications feature (types, mock, http, api), Topbar bell with unread count and dropdown, `/notificaciones` page, sidebar entry; `frontend/.env.example`; status docs sync.
- Out: forms/task templates management UI, employee answer/claim flow UI, photo upload UI, web push (FCM web), backend changes, tests/CI (user deferred tests and CI/CD to the end).

## Constraints

- Follow `teamworkflow-frontend`, `teamworkflow-nextjs`, `teamworkflow-react`, `teamworkflow-tailwind`, `teamworkflow-typescript` skills.
- Same pattern as `features/organization` and `features/billing` (`api.ts` switch, `http.ts` via `shared/lib/http.ts` `apiFetch`, `mock.ts`, `types.ts` mirroring backend DTOs).
- UI copy in Spanish (existing project convention), code and comments in English.
- No backend changes. `WEB_ORIGIN` is not read by any backend code (only `docker-compose.yml:91`); document it, do not implement CORS.

## TDD

Mode: off. Source: frontend has no test runner or test script (`frontend/package.json`). Checks: `npx tsc --noEmit` and `pnpm lint` in `frontend/`.

## Tasks

- [x] T1 Tasks HTTP client: `features/tasks/http.ts` for `GET /tasks` (paginated `page`/`pageSize`, map to the view), report computed client-side from the list (no backend report endpoint), `USE_MOCKS` switch in `api.ts`; align `types.ts` with the backend task response. Route: delegated (writer trigger, 2+ non-trivial files).
- [x] T2 Notifications feature: `features/notifications/` (types, mock, http, api) for `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read` (and `all`); Topbar bell with unread badge and dropdown; `app/(dashboard)/notificaciones/page.tsx`; sidebar entry and access rule for every role. Route: delegated (writer trigger).
- [~] T3 Config and docs: `frontend/.env.example` (`NEXT_PUBLIC_USE_MOCKS`, `NEXT_PUBLIC_WS_URL`, `BACKEND_URL`); sync root `AGENTS.md`, `STEPS.index.md`, `backend/core/AGENTS.md`, `README.md`, and Project Status of `teamworkflow-nest`, `teamworkflow-frontend`, `teamworkflow-nextjs` skills. Route: delegated (preparation trigger, 4+ files).

## Acceptance criteria

- With `NEXT_PUBLIC_USE_MOCKS=false`, the Tasks screen lists tasks from `GET /api/v1/tasks`; with mocks it still works.
- Topbar shows the unread count; the dropdown and the page list notifications and mark one or all as read.
- `npx tsc --noEmit` and `pnpm lint` pass in `frontend/`.
- No stale "docs only / not built" statement left for built modules.

## Delivery

Strategy: `single-pr` (user choice 2026-11-16, despite forecast over budget). Forecast about 700 authored lines (T1 ~150, T2 ~400, T3 ~150). One PR `feat/frontend/tasks-notifications` -> `develop`, one commit per task.

## Progress

- 2026-11-16: document created on branch `feat/frontend/tasks-notifications` (from `develop` at `0469217`).
- 2026-11-16: T1 done (route delegated, commits `2a46c5b`, `efe6fe5`). `GET /tasks` returns `{ items, total }` (raw Prisma rows, ISO dates, uppercase enums, ordered by deadline asc); the http client pages 100 at a time up to 10 pages (1000 tasks) and builds the report client-side (`report.ts`, shared with the mock). Checks: `npx tsc --noEmit` exit 0; `pnpm lint` 0 errors, 2 pre-existing warnings (`window.location.href` in `app/(dashboard)/layout.tsx` and `shared/hooks/useSession.ts`). Note: `pnpm` auto-installed the already declared `leaflet` deps into `node_modules` (no `package.json` change).
- 2026-11-16: T2 done (route delegated, commits `a6e4465`, `0085721`, `4d05507`, `10b54f0`). Bell polls unread count every 60s, refreshes on open and via a `tw:notifications-changed` window event after mutations; dropdown shows 8 recent items; `/notificaciones` has all/unread filter, mark one/all, pagination (20). No route rule added: `canAccessRoute` is open for routes without a rule, so every role can open it. First commit holds 4 files (data layer is not splittable without breaking the build). Checks: same tsc/lint results as T1 (run with T2 files in place).

- 2026-11-16: T3 partial (route delegated). Docs synced and committed: `STEPS.index.md` (rows B2, B4, B5 done; B6, B7 in progress with Docker verification pending; F0-F2; Next action), root `AGENTS.md`, `backend/core/AGENTS.md` (CORS not enabled in code, `WEB_ORIGIN` not read by core, only passed to telemetry in `docker-compose.yml:91`, roles inline), `README.md`, skills `teamworkflow-nest`, `teamworkflow-frontend`, `teamworkflow-nextjs`. `frontend/.env.example` could not be written (permission denied on the path): content `NEXT_PUBLIC_USE_MOCKS=true`, `NEXT_PUBLIC_WS_URL=http://localhost:8080`, `BACKEND_URL=http://localhost:8080` with comments (defaults from `shared/lib/config.ts` and `next.config.ts`); note `frontend/.gitignore` has `.env*`, so it also needs `!.env.example`. Checks after last change: `npx tsc --noEmit` exit 0.

- 2026-11-16: verification. Native assess (`--base-ref develop --committed-only`): risk high, so an independent read-only verifier ran: PASS WITH ISSUES (all low). Fixed in `424bfb5`: unread badge polling skips hidden tabs and stops on 401 (avoided a refresh attempt every minute without a session). Accepted as known limits: tasks report truncated past 1000 tasks; report by-site omits sites with zero tasks; mock `listTasks` ignores `siteId`; backend overrides a supervisor's `siteId` filter with their own sites. Parent checks after the fix: `npx tsc --noEmit` ok, `eslint features/notifications` ok; full `pnpm lint` before the fix 0 errors, 2 pre-existing warnings. Pending for the user: create `frontend/.env.example` (agent write denied) and add `!.env.example` to `frontend/.gitignore`.

## Next step

User creates `frontend/.env.example` (write denied by permission rules; content in the T3 progress line and the final report), then open the single PR `feat/frontend/tasks-notifications` -> `develop` after confirming push.
