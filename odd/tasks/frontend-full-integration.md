# Frontend full integration

## Objective
Make the frontend cover every backend capability and run against the real local backend, with auth tokens in httpOnly cookies instead of localStorage.

## Problem / Why
Tokens live in localStorage (XSS-readable). Screens are mostly read-only and several backend features (employees, shifts, users/invitations, password reset, clock events, workdays, live tower) have no UI.

## Decisions
- SUPERSEDED (F8): auth via a Next BFF (user, 2026-11-10: "http only"; route chosen by orchestrator): Next route handlers call core `/auth/*` and set `access_token`/`refresh_token` as httpOnly, SameSite=Lax cookies. A catch-all route handler `app/api/v1/[...path]` forwards to `BACKEND_URL`, reading the cookie and sending `Authorization: Bearer` (core only accepts bearer), refreshing once on 401. Mutating requests are checked by Origin. Backend unchanged. Socket.IO connects to the proxy origin; telemetry reads the `access_token` cookie from the handshake (cookies are shared across localhost ports).
- No tests (user request); per task only `tsc --noEmit`. Fix issues on the way.

- 2026-11-10 decision: adopt the teammate's backend-owned cookie auth (core sets httpOnly `access_token` Path=/, httpOnly `refresh_token` Path=/api/v1/auth, readable `csrf_token` Path=/; double-submit `X-CSRF-Token`) and drop our Next BFF. `/api/v1/*` is proxied by the `next.config.ts` rewrite to `BACKEND_URL`.

## Tasks
- [x] F1 (b777e58) Auth BFF: cookie login/register/refresh/logout, API proxy route, drop localStorage, route protection (`proxy.ts`), session user in Topbar + logout.
- [x] F2 (122f1c8) Organization: sites create/edit + rotate QR, posts create/edit, employees screen (list/create/edit), shifts screen (list/create/edit/reassign/cancel).
- [x] F3 (9ab43a7) Users & access: invitations (create/list/regenerate), user role/sites/deactivate, admin password reset link; public pages accept-invitation and password-reset confirm.
- [x] F4 (af30bda) Attendance: clock events list + manual entry + correction, workdays list/detail, live tower over Socket.IO.
- [x] F5 (e29343c; partial: `.env.example` could not be created, write denied by permission rules; template content in the final report) Wire-up: sidebar entries, `.env.example`, run instructions.

- [x] F6 (1358577) Role-based access: one permissions module (role -> capabilities, route -> capability) used by `proxy.ts` redirects, sidebar filtering and a `Can`/`useCan` guard for actions; per-role landing page.
- [x] F7 Employee "Mi jornada": QR clock-in (geolocation + QR token, camera via BarcodeDetector when available, manual code fallback) and own workdays.
- [x] F8 (c0469f3) Adopt core cookie auth: BFF route handlers and `shared/server` removed, login/register/invitation/password reset via the shared http client, session claims from the token pair, `proxy.ts` decides from `access_token`/`csrf_token`.
- [x] F9 (7aaba05) Billing: tenant `/facturacion` (owner/admin) and platform `/plataforma/facturacion` (`platform_admin`), capabilities `billing.manage`/`platform.billing`, Spanish messages for `feature_not_in_plan` and suspended/cancelled tenants.

## Checks
- TDD off (user). `pnpm exec tsc --noEmit` per task. No lint/build by request.

## Routing
- F1-F5 delegated to one writer (2+ non-trivial files).

## Progress
- 2026-11-10: document created; branch `feat/frontend/full-integration` from `develop`.
- 2026-11-10: F1 done: BFF routes `/api/auth/{login,register,logout,session}`, catch-all `/api/v1/[...path]` with refresh+retry and Origin check, `proxy.ts`, localStorage removed. tsc --noEmit clean. Gap: JWT has only sub/tenantId/role and core has no "me" endpoint, so Topbar shows role + short user id (no name/email).
- 2026-11-10: F2 done: sites create/edit/rotate QR, posts create/edit, Employees (`/empleados`) and Shifts (`/turnos`) screens with modals; mock writes reject (demo is read-only). tsc --noEmit clean.
- 2026-11-10: F3 done: `/usuarios` (invitations create/list/regenerate with link modal; role/sites/deactivate/password-reset link for employees with userId or a pasted user id), public `/invitations/accept` and `/password-reset`, BFF routes `/api/auth/accept-invitation` and `/api/auth/password-reset-confirm`. Gap: core has no list-users endpoint. tsc --noEmit clean.
- 2026-11-10: F4 done: `/asistencia` (clock events list/filters, manual clock-in, correction; workdays list + detail by shiftId), live tower via `socket.io-client@^4.8.4` (telemetry uses socket.io ^4.8.1) on path `/ws`, `site_summary_updated`, polling fallback every 15 s. tsc --noEmit clean.
- 2026-11-10: F5 done: sidebar entries Empleados/Turnos/Asistencia/Usuarios. `frontend/.env.example` blocked by a deny rule on `.env*` paths (also `.gitignore` ignores `.env*`, so it needs `!.env.example`). tsc --noEmit clean.
- 2026-11-10: F1-F5 committed; `tsc --noEmit` clean (re-run by orchestrator). Pending: user creates `frontend/.env.example` (agent writes to `.env*` denied) and sets `WEB_ORIGIN=http://localhost:3002` in `backend/.env`; manual local smoke.
- 2026-11-10: user asked for role-based screens/redirects ("aplica la mejor arquitectura"); F6-F7 added. Route: delegated writer.
- 2026-11-10: F6 done: `frontend/shared/auth/permissions.ts` (roles, capabilities, ROUTE_RULES, `can`, `canAccessRoute`, `homeFor`, `manageableRoles`) is the single source; `proxy.ts` redirects by access-token role, `RouteGuard` re-checks with the refreshed session, Sidebar filtered by route rules, `Can`/`useCan`, action buttons gated per capability, users screen offers only manageable roles, `/sin-acceso` page, 403 `forbidden` shows "No tenés permiso". Route: delegated writer (single). tsc --noEmit clean. Employees can read no sites/posts, so QR clock-in must take the site from own shifts (F7).
- 2026-11-10: F7 done: `/mi-jornada` (`MyShiftView`): own open shifts (site taken from the shift, employees cannot read sites), clock type, QR code by camera (native `BarcodeDetector`, manual field fallback) or `navigator.geolocation` (GPS) -> `POST /telemetry/clock-events`, Spanish messages for invalid_qr/no_matching_shift/clock_too_old/validation_error; own clock events and workdays. Out-of-geofence is not an error in the backend (event saved + alert), shown as a warning. tsc --noEmit clean.
- 2026-11-10: rebased onto origin/develop (37 upstream commits; conflicts only in layout, Sidebar, http.ts, login, register, resolved taking upstream and re-applying our additions). F8 done: cookie auth adopted, BFF removed. Gap: core `POST /auth/invitations/accept` returns a token pair but sets no cookies, so after accepting the user is sent to /login. F9 done: billing screens; gap: core has no plan listing for `platform_admin`, so the platform screen edits a plan by code. tsc --noEmit clean.
