# Frontend quick wins after the first deploy

## Objective

Fix four small gaps the user found while smoke-testing the deployed app (https://teamworkflow.duckdns.org), all frontend-only.

## Problem and why

- The sidebar is a fixed 256 px column with no way to close it; on a phone it takes half the screen.
- A new company lands on the Pro plan with no explanation: it is the 14-day Pro trial by design (billing creates it on `tenant_created`), but the register page never says so.
- The site map hides the OpenStreetMap attribution (`attributionControl: false` in `SiteMap.tsx`), which the OSM licence requires.
- Creating an employee offers no access role; roles live in auth invitations (`POST /auth/invitations` with `{ email, role }`), reachable today only from the Users page.

## Decisions

- Frontend only: every backend route already exists. No schema or API change.
- Sidebar: a menu button in the top bar toggles it. Below `lg` it is an off-canvas drawer with a backdrop that closes on navigation; on `lg` and up it hides or shows, and the choice is remembered per browser (localStorage, wrapped in try/catch).
- Trial: copy only (register page notice and a visible trial note where the subscription is shown, if not already clear). No plan picker at signup.
- Employee role: on create, an optional "Access" select (no account / employee / supervisor). When a role is chosen and the employee has an email, the form sends the invitation after the profile is created; a failed invitation does not undo the profile and shows a clear message pointing to the Users page.
- OSM attribution: re-enable the attribution control (or render the equivalent credit).

## Scope and constraints

- Out of scope: address geocoding (next feature), task and form creation (separate feature), plan picker, structured address columns.
- English for code and comments; UI copy follows the existing UI language (Spanish).

## Tasks

- [x] **T1** Sidebar toggle: top bar button, mobile drawer, desktop hide/show remembered. Route: delegated (writer trigger).
  - Evidence: `shared/providers/SidebarProvider.tsx` (new; context + useSyncExternalStore for localStorage pref and `lg` media query, in-memory fallback, close on route change by render-phase state adjust), `components/layout/Sidebar.tsx` (off-canvas drawer, backdrop, Escape, `inert` when hidden), `Topbar.tsx` (menu button with aria-label/expanded/controls), `app/(dashboard)/layout.tsx`. No Zustand (not installed). Checks: lint 0 errors / 2 pre-existing warnings (`window.location.href`), tsc 0. Commits 377cae0, ef370c8. Not verified: visual behavior in a browser.
- [x] **T2** Trial notice on register (and subscription view if needed). Route: delegated (same writer).
  - Evidence: notice in `app/register/page.tsx`; `SubscriptionPanel` already shows the `Período de prueba` badge plus the trial end date, so unchanged. Checks: lint 0 errors, tsc 0 (run together with T3/T4). Commit 43dd49d.
- [x] **T3** OSM attribution on the site map. Route: delegated (same writer).
  - Evidence: `SiteMap.tsx` attribution control on, tile layer `attribution` with the OSM copyright link. Checks as T2. Commit 735a79e. Not verified: rendering in a browser.
- [x] **T4** Access role on employee create (invitation after profile). Route: delegated (same writer).
  - Evidence: `EmployeeFormModal.tsx`: create-only `Acceso` select (Sin cuenta / Empleado / Supervisor, filtered by `manageableRoles`, disabled without email); `accessApi.createInvitation` after the profile; on failure the profile stays and a message points to Usuarios. Mock mode: writes are `mockUnavailable` already, so creation itself is unavailable there (unchanged). Import cycle removed in 0400537: the modal takes `onInvite` and `inviteRoles` props (types in `organization/types.ts`); `app/(dashboard)/empleados/page.tsx` (now a client page) wires `accessApi.createInvitation` and the role options, so `features/organization` has zero imports of `features/access`. Checks as T2. Commit a2053b2. Not verified: real invitation flow against the backend.

## Acceptance criteria

- On a phone-width screen the sidebar starts closed and opens/closes from the top bar; on desktop it can be hidden and stays hidden after a reload.
- The register page states that new companies start a 14-day free Pro trial.
- The site map shows the OpenStreetMap credit.
- Creating an employee with email and role "Supervisor" creates the profile and sends a supervisor invitation.

## Checks

TDD: off (no project or session setting; the frontend has no unit test runner). Per task: `pnpm lint` and `npx tsc --noEmit` in `frontend/`; `pnpm build` once at the end. Mock mode keeps working.

## Delivery

Forecast: ~250-400 authored changed lines. Strategy: `ask-on-risk`; one PR. Branch `feat/frontend/quick-wins`, stacked on `feat/deploy/donweb` so the next image tag carries both.

## Progress

- Mapping done (read-only explorer): all four are frontend-only gaps; evidence in Engram `frontend/ux-gaps-after-deploy`.
- T1-T4 done. `pnpm build` passes. Next step: user review, then push/PR (ask first).
