# Frontend prototype (demo)

## Objective
Clickable frontend prototype to show today, built on the style of the existing login and dashboard layout (branch `origin/feat/frontend/dashboard-layout`, by Angela).

## Problem / Why
The sidebar links (Torre de Control, Sedes y Geocercas, Tareas y Reportes) point to routes that do not exist, and the dashboard home is a placeholder. A demo needs every screen navigable with realistic content.

## Scope
- Branch `feat/frontend/prototype`, created from `origin/feat/frontend/dashboard-layout` (upstream unset so it never pushes to Angela's branch).
- Screens under `app/(dashboard)/`: home summary, `/torre-control`, `/sedes`, `/tareas`.
- Static mock data only, no backend calls (beyond the existing login).
- UI copy in Spanish, matching the existing screens.

## Constraints
- Reuse the existing design tokens in `app/globals.css` (light and dark), Sidebar and Topbar. Do not restyle Angela's files beyond additive changes.
- Additive `@theme inline` mapping of the CSS variables is allowed so new screens can use Tailwind classes instead of inline `style`.
- pnpm only; do not touch `package-lock.json` in this branch (flag to the team).
- No new dependencies unless unavoidable.

## Decision (user, 2026-10-29)
Frontend first; at the end close organization T7 (docker compose core + telemetry, `odd/tasks/organization-module.md`) and integrate with real data. Screens read from a per-domain data layer typed after the real backend DTOs (organization on local branch `feat/backend/org-shift-lifecycle`, telemetry on `origin/develop`); today it returns mocks, at integration it switches to real HTTP without touching screens. Tasks module has no backend, stays mock.

## Tasks
- [x] P1 Foundations: Tailwind `@theme inline` token mapping, types mirroring backend DTOs, per-domain data layer with mock implementation and a single switch for real HTTP, home summary (KPIs and links to the three areas). Commit `2bede04`. Route: delegated.
- [x] P2 Torre de Control: KPI tiles, staff status by site (shape of `GET /api/v1/telemetry/tower/snapshot`), alerts feed with acknowledge/resolve (mocked). Commit `6d37aaf`. Route: delegated.
- [x] P3 Sedes y Geocercas: site list and site detail with geofence, posts, employees and shifts (shapes of organization routes); map placeholder. Commit `6afb156`. Route: delegated.
- [x] P4 Tareas y Reportes: task list with status filters, report summary (pure mock, no backend contract yet). Commit `8dd76a6`. Route: delegated.
- [ ] P5 Integration (after organization T7): switch data layer to real HTTP, login token wired, live tower via WebSocket `site_summary_updated`.

## Acceptance criteria
- Every sidebar link opens a populated screen; active state works.
- Light and dark themes both read well.
- `pnpm lint` clean; `pnpm build` passes once at the end.

## Checks
- TDD: off (not configured). Per task: `pnpm lint`. At the end: `pnpm build`.

## Delivery
- Strategy `ask-on-risk`; one work-unit commit per task. Push/PR only after user confirmation (PR targets `develop` or Angela's branch, to decide).

## Routing
- P1–P4 delegated to one writer (2+ non-trivial files).

## Progress
- 2026-10-29: document created; branch created.
- 2026-10-29: P1-P4 implemented by one delegated writer (commits 2bede04, 6d37aaf, 6afb156, 8dd76a6). `pnpm lint`: only the pre-existing problems in Angela's files (layout.tsx:19 and Topbar.tsx:16 `react-hooks/set-state-in-effect` errors, 4 `no-location-assign-relative-destination` warnings); none in new files. Lint takes ~12 min on this machine, so it ran once over the cumulative P1-P4 tree. Mock switch: `NEXT_PUBLIC_USE_MOCKS=false` flips organization and telemetry to real HTTP; tasks stays mock.
- 2026-10-29: P5 partial. cbc7c94: Next rewrites `/api/v1/*` to `BACKEND_URL` (default proxy :8080); local `.env.local` sets `NEXT_PUBLIC_USE_MOCKS=false` (not tracked). Backend smoke through the proxy passes (sites, tower snapshot, alerts). Pending: verify screens against real responses, WebSocket `site_summary_updated`, `.env.example`. Next: PRs to `develop` for this branch and `feat/backend/org-shift-lifecycle` (user confirmed 2026-10-29).
