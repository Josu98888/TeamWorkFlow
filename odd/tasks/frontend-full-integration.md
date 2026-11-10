# Frontend full integration

## Objective
Make the frontend cover every backend capability and run against the real local backend, with auth tokens in httpOnly cookies instead of localStorage.

## Problem / Why
Tokens live in localStorage (XSS-readable). Screens are mostly read-only and several backend features (employees, shifts, users/invitations, password reset, clock events, workdays, live tower) have no UI.

## Decisions
- Auth via a Next BFF (user, 2026-11-10: "http only"; route chosen by orchestrator): Next route handlers call core `/auth/*` and set `access_token`/`refresh_token` as httpOnly, SameSite=Lax cookies. A catch-all route handler `app/api/v1/[...path]` forwards to `BACKEND_URL`, reading the cookie and sending `Authorization: Bearer` (core only accepts bearer), refreshing once on 401. Mutating requests are checked by Origin. Backend unchanged. Socket.IO connects to the proxy origin; telemetry reads the `access_token` cookie from the handshake (cookies are shared across localhost ports).
- No tests (user request); per task only `tsc --noEmit`. Fix issues on the way.

## Tasks
- [x] F1 (8fcaf03) Auth BFF: cookie login/register/refresh/logout, API proxy route, drop localStorage, route protection (`proxy.ts`), session user in Topbar + logout.
- [ ] F2 Organization: sites create/edit + rotate QR, posts create/edit, employees screen (list/create/edit), shifts screen (list/create/edit/reassign/cancel).
- [ ] F3 Users & access: invitations (create/list/regenerate), user role/sites/deactivate, admin password reset link; public pages accept-invitation and password-reset confirm.
- [ ] F4 Attendance: clock events list + manual entry + correction, workdays list/detail, live tower over Socket.IO.
- [ ] F5 Wire-up: sidebar entries, `.env.example`, run instructions.

## Checks
- TDD off (user). `pnpm exec tsc --noEmit` per task. No lint/build by request.

## Routing
- F1-F5 delegated to one writer (2+ non-trivial files).

## Progress
- 2026-11-10: document created; branch `feat/frontend/full-integration` from `develop`.
- 2026-11-10: F1 done: BFF routes `/api/auth/{login,register,logout,session}`, catch-all `/api/v1/[...path]` with refresh+retry and Origin check, `proxy.ts`, localStorage removed. tsc --noEmit clean. Gap: JWT has only sub/tenantId/role and core has no "me" endpoint, so Topbar shows role + short user id (no name/email).
