# List pages: shared table, filter and modal design

## Objective
Give the management list pages one consistent look that matches the new sidebar (`sidebar-glass`) and cards (`glow-cards`): Empleados, Usuarios, Turnos, Notificaciones and Facturación plataforma. No per-page prototype; the visual language comes from the existing designs in `odd/designs/` (glow-cards list rows, sidebar-glass pills and chips).

## Problem and why
After the sidebar and card redesign, these pages still use the old tables, filters and modals, so the app looks half migrated. They share the same structure (header, filters, table or list, form modal), so one shared pattern covers all five instead of five separate designs (user decision, 2026-11-18).

## Scope
- In: shared presentational pieces in `frontend/shared/components/` (page toolbar with search and filters, data table or list rows, status chips, empty and loading states, modal styling, buttons) and their use in `EmployeesView`, `UsersView`, `ShiftsView`, `NotificationsView`, `PlatformBillingView`.
- Out: data, API calls and business logic (unchanged); Tareas (waits for the forms builder feature); pages that get their own design (Mi jornada, Torre de Control, Panel principal, Asistencia, Sedes, Facturación); `/sin-acceso` (follow-up on the auth branch, reuses `AuthShell`).

## Constraints
- `teamworkflow-frontend`, `teamworkflow-react`, `teamworkflow-tailwind`: semantic tokens only, no `#hex` in JSX, reuse the tokens added by `sidebar-glass` and `glow-cards`.
- Keep every existing prop, behaviour, error message and accessibility attribute; light and dark themes; mobile (390 px) friendly: tables become stacked rows or scroll horizontally inside the card.
- No new dependencies.

## Tasks
- [x] L1 Shared pieces: toolbar (search + filters + primary action), table/list row style, status chip, empty/loading states, modal and button refresh. Route: delegated (writer trigger). Evidence: commit 04dc7c9; new `shared/components/List.tsx` (Toolbar, RowList, ListRow, DataTable) and `list.css`; States, Modal, Button, Fields restyled; status chip reuses Badge; lint 0 errors, tsc clean.
- [x] L2 Apply to Empleados and Usuarios. Route: delegated (same writer). Evidence: commit 295d18f; EmployeesView, UsersView; lint, tsc clean.
- [x] L3 Apply to Turnos, Notificaciones and Facturación plataforma. Route: delegated (same writer). Evidence: commit bf0fb40; ShiftsView (DataTable), NotificationsView + NotificationItem (variant row), PlatformBillingView, InvoiceTable (also used by tenant BillingView); lint, tsc, pnpm build pass. No browser check done.
- [ ] L4 User visual check at 1280 and 390 px, light and dark; `pnpm lint` and `pnpm build`.

## Checks
TDD: off (no frontend unit runner). Per task: `pnpm lint`, `npx tsc --noEmit`; `pnpm build` at the end.

## Delivery
Branch `feat/frontend/list-pages`, stacked on `feat/frontend/glow-cards` (needs its tokens and `Card`). Forecast ~400-600 lines; strategy `ask-on-risk`.

## Progress
- L1-L3 done (no search/filter features added; existing server-side filters kept). Next: L4 user visual check at 1280 and 390 px, light and dark.
