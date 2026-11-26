# PATH — Fichado de Salida (`OUT`), Ventana de Entrada (15 min) y Horas Extras por Puesto/Turno

> **Objetivo:**
> 1. Diagnosticar el estado actual del fichado de salida en `backend/telemetry` y `frontend/`.
> 2. Restringir el fichado de entrada a un máximo de **15 minutos antes** (`CLOCK_IN_EARLY_MINUTES = 15`) mostrando en la app el cartel **`"Hora de entrada a las XX:XX"`** si intenta fichar antes.
> 3. Permitir **asignar horas extra a trabajadores de un puesto en un turno específico** desde las tablas de puestos / turnos laborales (`core/organization` + `telemetry` + `frontend/`).
> 4. Corregir las brechas detectadas en el fichado de salida (`OUT`), estado `ABSENT` y detección de `MISSING_CLOCK_OUT` para garantizar el cálculo exacto de horas trabajadas y horas extras.

---

## 1. Diagnóstico del Estado Actual (Lo que YA existe vs Lo que DEBE modificarse)

### 1.1 Qué SÍ está implementado hoy
- **Modelo (`backend/telemetry/src/prisma/schema.prisma`):** `ClockEventType` ya tiene `IN`, `OUT`, `BREAK_START`, `BREAK_END`, y `Workday` ya almacena `workedMinutes`, `overtimeMinutes`, `lateMinutes` y `status` (`OPEN | CLOSED | MISSING_CLOCK_OUT`).
- **Ingesta (`backend/telemetry/src/clock-ins/clock-ins.service.ts`):** `POST /api/v1/telemetry/clock-events` ya acepta `type: 'out'`, busca un `IN` abierto, verifica geocerca/QR y recalcula `Workday`.
- **Cálculo (`backend/telemetry/src/workdays/workdays.service.ts`):** `recomputeWorkday` suma intervalos `IN -> OUT` descontando `BREAK_START -> BREAK_END`.

### 1.2 Modificaciones OBLIGATORIAS detectadas en el código actual

| # | Ubicación actual | Situación actual | Cambio requerido |
|---|---|---|---|
| **M1** | `backend/telemetry/src/shifts/shift-snapshot.service.ts` (línea 7) y `clock-ins.service.ts` | `CLOCK_IN_EARLY_MINUTES = 60` permite fichar hasta 1 h antes, y fuera de ventana devuelve un genérico `404 no_matching_shift`. | Cambiar `CLOCK_IN_EARLY_MINUTES = 15`. Si intenta fichar `IN` antes de `startsAt - 15 min` para un turno próximo, devolver `422 clock_in_too_early` con la hora formateada en la timezone de la sede (`"Hora de entrada a las XX:XX"`), y mostrar ese cartel en `MyShiftView.tsx`. |
| **M2** | `backend/core/src/organization/prisma/schema.prisma`, `shifts.service.ts`, `ShiftSnapshot`, `ShiftsView.tsx`, `SiteDetailView.tsx` | `Shift` y `ShiftSnapshot` no tienen asignación de horas extra por turno/puesto. No existe UI ni endpoint para asignarle horas extra a los trabajadores de un puesto en un turno específico. | Agregar `authorizedOvertimeMinutes` (y metadata de asignación) en `Shift` (`organization`), replicarlo a `ShiftSnapshot` (`telemetry`), exponer asignación en las tablas de puestos/turnos (`ShiftsView.tsx`, `SiteDetailView.tsx`) y ajustar `effectiveEndsAt = endsAt + authorizedOvertimeMinutes` en ciclo de vida, ventana de fichado y `MISSING_CLOCK_OUT`. |
| **M3** | `backend/telemetry/src/alerts/alerts.service.ts` (`runPeriodicChecks`, líneas 407–460) | El cron solo consulta turnos `SCHEDULED` / `IN_PROGRESS` y saltea tenants sin `features.alerts`. Cuando `organization` pasa el turno a `COMPLETED` en `endsAt`, el cron **nunca** vuelve a revisar ese turno 2 h después y jamás marca `MISSING_CLOCK_OUT`. | Crear `WorkdaysMonitorJob` independiente de `features.alerts` que revise turnos `OPEN` hasta `effectiveEndsAt + 2h` (aunque el `ShiftSnapshot` ya esté `COMPLETED`) y materialice `MISSING_CLOCK_OUT` y `ABSENT`. |
| **M4** | `backend/telemetry/src/prisma/schema.prisma` (`WorkdayStatus`) y `workdays.service.ts` | No existe estado `ABSENT` en `WorkdayStatus`. Un turno finalizado sin `IN` queda en `OPEN` con `0` minutos o sin fila. | Agregar `ABSENT` a `WorkdayStatus`, junto con `authorizedOvertimeMinutes`, `rawOvertimeMinutes`, `postId`, `scheduledMinutes`, `firstInAt`, `lastOutAt`, `hasOutOfGeofence`. |
| **M5** | `backend/telemetry/src/clock-ins/clock-ins.service.ts` (líneas 103–149) | Permite doble `IN` abierto en el mismo turno y no valida `OUT.deviceTime >= openIn.deviceTime` ni secuencia de breaks. | Bloquear doble `IN` (`409 already_clocked_in`), validar secuencia cronológica (`409 invalid_clock_sequence`) y agregar `GET /clock-events/active`. |
| **M6** | `frontend/features/telemetry/components/MyShiftView.tsx` (línea 57) | `isOpen` filtra solo `IN_PROGRESS` / `SCHEDULED`. Apenas el turno pasa a `FINISHED`, el trabajador que se quedó haciendo horas extras **no puede fichar la salida** desde la web. | Mantener visible en `MyShiftView` todo turno con `IN` abierto (vía `GET /clock-events/active`), preseleccionar `Salida` cuando hay `IN` abierto y mostrar el cartel `"Hora de entrada a las XX:XX"` cuando falten más de 15 min. |

---

## 2. Fases y Pasos de Implementación

### Fase 0 — Contratos y Reglas en Documentación
Commits: (solo documentación)

- [ ] **OUT-0.1** Actualizar reglas en `backend/telemetry/AGENTS.md`, `backend/core/src/organization/AGENTS.md`, `backend/core/AGENTS.md` y `docs/architecture.md`:
  - `CLOCK_IN_EARLY_MINUTES = 15` (entrada permitida desde 15 min antes de `startsAt` hasta `effectiveEndsAt = endsAt + authorizedOvertimeMinutes`).
  - Nuevo código de error `clock_in_too_early` (`422`) + `already_clocked_in` (`409`) + `invalid_clock_sequence` (`409`).
  - Nuevo campo en `Shift` / `ShiftSnapshot` / `TelemetryShiftDto`: `authorizedOvertimeMinutes` (int >= 0, default `0`).
  - Nueva operación de `organization`: `organization.shift.assign-overtime` (`POST /api/v1/shifts/:shiftId/overtime`).
  - Payload documentado para `t.<tenant>.attendance.workday_closed`.
  - Check: Contratos consistentes entre `core`, `telemetry` y `docs/architecture.md`.

---

### Fase 1 — Asignación de Horas Extra en Puestos/Turnos (`core/organization`)
Commits: —

- [ ] **OUT-1.1** Actualizar `backend/core/src/organization/prisma/schema.prisma`:
  - En modelo `Shift`:
    - `authorizedOvertimeMinutes Int @default(0) @map("authorized_overtime_minutes")`
    - `overtimeReason String? @map("overtime_reason")`
    - `overtimeAssignedByUserId String? @map("overtime_assigned_by_user_id") @db.Uuid`
    - `overtimeAssignedAt DateTime? @map("overtime_assigned_at") @db.Timestamptz(3)`
  - Crear y revisar migración `add_shift_authorized_overtime` (`CHECK (authorized_overtime_minutes >= 0)`).
  - Check: `pnpm run prisma:organization:generate` y `prisma validate --config prisma.organization.config.ts` pasan.
- [ ] **OUT-1.2** Implementar asignación de horas extras en `ShiftsService`, `OrganizationService` y `ShiftsController` (`backend/core/src/organization/shifts/`):
  - Nuevo DTO `AssignShiftOvertimeBodyDto`: `version: number`, `authorizedOvertimeMinutes: number` (`@IsInt()`, `@Min(0)`, `@Max(720)` — o aceptar `overtimeHours` decimal/entero en el frontend convertido a minutos; o campo `authorizedOvertimeMinutes` entero en múltiplos de 15/1), `reason?: string`.
  - Nuevo endpoint `POST /api/v1/shifts/:shiftId/overtime` (y opcionalmente soportar `authorizedOvertimeMinutes` en `CreateShiftBodyDto` / `UpdateShiftBodyDto`):
    - Roles: `owner`, `admin`, y `supervisor` dentro de sus `siteIds` (o restringible según política).
    - **Importante:** permitir asignar o ajustar horas extras en turnos `SCHEDULED` e `IN_PROGRESS` (e incluso en `FINISHED` reciente? `DEFAULT`: en `SCHEDULED` y `IN_PROGRESS`, y si se necesita aprobar sobre un turno ya `FINISHED` sin cancelar, permitir con `reason` obligatorio hasta cierre de mes).
    - Verificar superposición contra otros turnos del empleado usando `effectiveEndsAt = endsAt + authorizedOvertimeMinutes * 60000` bajo `lockEmployee` + bloqueo optimista por `version`!
    - Emitir `shift_updated` (y `shift_created` si se crea con horas extras) incluyendo `authorizedOvertimeMinutes` en el snapshot JetStream.
  - Actualizar `ShiftLifecycleService` (`src/organization/shifts/shift-lifecycle.service.ts`):
    - Considerar si `shift_ended` se emite al llegar `endsAt` (fin de jornada regular) o `endsAt + authorizedOvertimeMinutes` (`effectiveEndsAt`).
    - `DEFAULT`: `ShiftLifecycleService` mantiene la transición a `FINISHED` usando `effectiveEndsAt = endsAt + authorizedOvertimeMinutes` (o mediante columna calculada/consulta), de modo que mientras el trabajador cursa sus horas extras asignadas el turno sigue `IN_PROGRESS`!
  - Actualizar `telemetry-wire.ts` (`TelemetryShiftDto`): incluir `authorizedOvertimeMinutes: number`.
  - Check: `shifts.service.spec.ts`, `shifts.controller.spec.ts`, `shift-lifecycle.service.spec.ts` y `organization.responder.spec.ts` prueban asignación, bloqueo optimista, solapamiento con horas extras y emisión en `shift_updated`.

---

### Fase 2 — Modelo de Datos en `telemetry` (`schema.prisma` + Migración)
Commits: —

- [ ] **OUT-2.1** Actualizar `backend/telemetry/src/prisma/schema.prisma`:
  - En `ShiftSnapshot`: agregar `authorizedOvertimeMinutes Int @default(0) @map("authorized_overtime_minutes")`.
  - En enum `WorkdayStatus`: agregar `ABSENT` (`OPEN`, `CLOSED`, `MISSING_CLOCK_OUT`, `ABSENT`).
  - En `Workday`:
    - `postId String? @map("post_id") @db.Uuid`
    - `scheduledMinutes Int @default(0) @map("scheduled_minutes")`
    - `authorizedOvertimeMinutes Int @default(0) @map("authorized_overtime_minutes")`
    - `rawOvertimeMinutes Int @default(0) @map("raw_overtime_minutes")`
    - `firstInAt DateTime? @map("first_in_at") @db.Timestamptz(6)`
    - `lastOutAt DateTime? @map("last_out_at") @db.Timestamptz(6)`
    - `hasOutOfGeofence Boolean @default(false) @map("has_out_of_geofence")`
    - Índice `@@index([tenantId, status, updatedAt], map: "idx_workday_tenant_status")`.
  - Check: `prisma validate` pasa; migración revisada con `ALTER TYPE "workday_status" ADD VALUE 'ABSENT'` y backfill seguro desde `shift_snapshots`/`clock_events`.
- [ ] **OUT-2.2** Actualizar `OrganizationConsumer` y `ShiftSnapshotService` para persistir `authorizedOvertimeMinutes` en `upsertShift` y `getShift`.
  - Check: `organization.handler.spec.ts` y `shift-snapshot.service.spec.ts` verifican propagación de `authorizedOvertimeMinutes`.

---

### Fase 3 — Ventana de 15 min, Cartel `"Hora de entrada a las XX"` y Validaciones de Salida (`clock-ins`)
Commits: —

- [ ] **OUT-3.1** Agregar excepciones en `backend/telemetry/src/common/exceptions/app.exceptions.ts` y `http-exception.filter.ts`:
  - `ClockInTooEarlyException`: status `422`, code `'clock_in_too_early'`, message `"Hora de entrada a las ${formattedTime}"` (calculada en la **zona horaria IANA de la sede** `SiteSnapshot.timezone`, formato `HH:mm`), con metadatos opcionales `shiftStartsAt`, `allowedFrom` si el filtro los expone (manteniendo `{ detail, code }` compatible!).
  - `AlreadyClockedInException`: status `409`, code `'already_clocked_in'`.
  - `InvalidClockSequenceException`: status `409`, code `'invalid_clock_sequence'`.
  - Check: `app.exceptions.spec.ts` y `http-exception.filter.spec.ts` verifican exactitud de `status`, `code` y `detail`.
- [ ] **OUT-3.2** Actualizar `ShiftSnapshotService` (`backend/telemetry/src/shifts/shift-snapshot.service.ts`):
  - Cambiar `export const CLOCK_IN_EARLY_MINUTES = 15;` (antes `60`).
  - Usar `effectiveEndsAt = endsAt + authorizedOvertimeMinutes * 60_000` como fin de la ventana válida del turno.
  - Agregar helper `findUpcomingTooEarlyShift(tenantId, employeeId, siteId, deviceTime)`: busca el próximo turno no cancelado de ese empleado en esa sede con `startsAt > deviceTime` dentro de las próximas 24 h (para detectar cuándo el trabajador intentó fichar antes de los 15 minutos previos!).
  - Check: `shift-snapshot.service.spec.ts` prueba:
    - 16 min antes de `startsAt` -> NO matchea y `findUpcomingTooEarlyShift` lo detecta.
    - 15 min antes de `startsAt` -> SÍ matchea.
    - Durante el turno y durante `authorizedOvertimeMinutes` -> SÍ matchea.
- [ ] **OUT-3.3** Endurecer `ClockInsService` (`backend/telemetry/src/clock-ins/clock-ins.service.ts`):
  - **En `IN`:**
    1. Llamar a `findMatchingShiftForClockIn`. Si es `null`, consultar `findUpcomingTooEarlyShift`; si existe un turno futuro cercano, obtener el `timezone` de la sede (desde `SiteSnapshot` / `SiteCacheService`), formatear `startsAt` en `HH:mm` y lanzar `new ClockInTooEarlyException(formattedTime)` -> `"Hora de entrada a las XX:XX"`. Si tampoco hay turno próximo, lanzar `NoMatchingShiftException` (`404`).
    2. Si ya existe un `IN` abierto en ese `shiftId`, lanzar `AlreadyClockedInException` (`409`).
  - **En `OUT`:**
    1. Buscar `IN` abierto en la sede (`orderBy: { deviceTime: 'desc' }`), sin restringir por `ShiftSnapshot.status` (permite fichar `OUT` aunque el turno haya pasado a `COMPLETED` mientras esté dentro de las 24 h).
    2. Validar `deviceTime.getTime() >= openIn.deviceTime.getTime()` (si no, `409 invalid_clock_sequence`).
  - **En `BREAK_START` / `BREAK_END`:** validar apertura/cierre de break y cronología.
  - **Nuevo endpoint `GET /api/v1/telemetry/clock-events/active`** (`@Roles('employee')`): retorna `{ hasOpenIn, isOnBreak, openShift, upcomingShifts }` con el estado vivo del empleado para que la UI sepa si toca entrada o salida y si está antes de los 15 min.
  - Check: `clock-ins.service.spec.ts` y `clock-ins.controller.spec.ts` cubren todos los casos (16 min antes -> `422 clock_in_too_early` con `"Hora de entrada a las XX:XX"`, 15 min antes -> `201`, doble `IN` -> `409`, `OUT` tardío en horas extras -> `201`).

---

### Fase 4 — Motor de Horas Extras Asignadas vs Trabajadas y Ausencias (`workdays`)
Commits: —

- [ ] **OUT-4.1** Crear función pura `calculateWorkdayMetrics(...)` (`backend/telemetry/src/workdays/domain/workday-calculator.ts`):
  - Recibe `shift` (`startsAt`, `endsAt`, `authorizedOvertimeMinutes`), `events[]`, y `now`.
  - Regla de cálculo:
    - `effectiveStart = max(inTime, shift.startsAt)` para el primer `IN` dentro de los 15 min previos (así entrar 10 min antes no genera 10 min extra falsos).
    - `scheduledMinutes = max(0, floor((endsAt - startsAt) / 60000))`.
    - `workedMinutes = sum(outTime - effectiveInTime) - breakMinutes`.
    - `rawOvertimeMinutes = max(0, workedMinutes - scheduledMinutes)`.
    - **Horas extras computables para pago (`overtimeMinutes`):**
      `overtimeMinutes = shift.authorizedOvertimeMinutes > 0 ? Math.min(rawOvertimeMinutes, shift.authorizedOvertimeMinutes) : 0`.
      *(Así se respeta la asignación de horas extras del puesto/turno específico y se verifica con el fichado de salida que realmente las trabajó!)*
    - `lateMinutes = max(0, floor((firstIn - startsAt) / 60000))`.
  - Estados:
    - `MISSING_CLOCK_OUT` si tiene `IN` abierto y `now >= effectiveEndsAt + 2h` (donde `effectiveEndsAt = endsAt + authorizedOvertimeMinutes * 60_000`) -> `workedMinutes = 0`, `overtimeMinutes = 0`, `rawOvertimeMinutes = 0`.
    - `CLOSED` si todos los `IN` tienen su `OUT`.
    - `ABSENT` si no hubo ningún `IN` y `now >= endsAt` (o `shift.status === 'COMPLETED'`).
    - `OPEN` en cualquier otro caso en curso.
  - Check: `workday-calculator.spec.ts` prueba todos los escenarios: turno normal sin horas extra asignadas, turno con 2 h extra asignadas y cumplidas (120 min), turno con 2 h extra asignadas pero solo 1 h trabajada (60 min), turno sin horas extra asignadas donde salió 30 min tarde (`rawOvertimeMinutes = 30`, `overtimeMinutes = 0`), llegada 12 min antes (0 extras), `MISSING_CLOCK_OUT` recién después de `endsAt + authorizedOvertimeMinutes + 2h`, y `ABSENT`.
- [ ] **OUT-4.2** Actualizar `WorkdaysService.recomputeWorkday` y crear `WorkdaysMonitorJob` (`src/workdays/workdays-monitor.job.ts`):
  - `WorkdaysMonitorJob` corre `@Cron('* * * * *')` sobre tenants no suspendidos (planes `basic` y `pro`):
    - Evalúa jornadas `OPEN` cuyo `effectiveEndsAt + 2h <= now` (sin importar si `ShiftSnapshot.status` ya es `COMPLETED`) y las transiciona a `MISSING_CLOCK_OUT` (abriendo alerta solo si `features.alerts`).
    - Evalúa turnos terminados asignados sin `Workday` aún y los materializa en `ABSENT`.
  - También cuando `OrganizationConsumer` recibe un `shift_updated` que modifica `authorizedOvertimeMinutes` de un turno ya fichado, dispara `workdays.recomputeWorkday(tenantId, shiftId)` para recalcular al instante!
  - Check: `workdays.service.spec.ts`, `workdays-monitor.job.spec.ts` y `alerts.service.spec.ts` pasan al 100%.

---

### Fase 5 — Frontend (`MyShiftView.tsx` y Tablas de Puestos / Turnos)
Commits: —

- [ ] **OUT-5.1** Actualizar `frontend/features/telemetry/components/MyShiftView.tsx` y `labels.ts`:
  - Mapear `clock_in_too_early` en `CLOCK_ERROR_MESSAGES` / manejo de errores mostrando el mensaje del servidor `"Hora de entrada a las XX:XX"`.
  - En `ClockCard`:
    - Si `type === 'in'` y falta más de 15 minutos para `shift.startsAt` (usando la timezone de la sede o `formatTime(shift.startsAt)`), mostrar un cartel de aviso visible **`"Hora de entrada a las XX:XX"`** y bloquear/alertar el intento anticipado.
    - Consultar `getActiveClockStatus()` para mantener visibles los turnos con `IN` abierto aunque estén `FINISHED` (permitiendo fichar `Salida` en horas extras) y preseleccionar `Salida` automáticamente cuando hay un `IN` abierto.
  - Check: `pnpm lint`, `tsc --noEmit` y `pnpm build` en `frontend/` pasan.
- [ ] **OUT-5.2** Actualizar tablas de puestos y turnos (`frontend/features/organization/`):
  - Actualizar `types.ts` (`Shift` incluye `authorizedOvertimeMinutes`), `api.ts` / `http.ts` / `mock.ts` (`assignShiftOvertime`).
  - En `ShiftsView.tsx` (tabla de turnos) y en `SiteDetailView.tsx` (tarjetas de puestos y turnos de la sede):
    - Mostrar columna/badge con horas extra asignadas (ej. `+2 h extra`).
    - Agregar botón/modal `"Asignar horas extra"` por fila de turno (ligado al puesto y trabajador de ese turno) para `owner` / `admin` / `supervisor`.
  - Check: `pnpm lint`, `tsc --noEmit` y `pnpm build` en `frontend/` pasan.

---

### Fase 6 — Done Checks
Commits: —

- [ ] **OUT-6.1** Ejecutar `pnpm lint`, `pnpm test` y `pnpm build` en `backend/core`, `backend/telemetry` y `frontend/`, más E2E de ventana 15 min, asignación de horas extra en puesto/turno y fichado de salida en horas extra.
  - Check: Todas las suites pasan con 0 errores.

---

## Decisions & Defaults to Confirm

- **CONFIRMADO:** Entrada máxima **15 minutos antes** (`CLOCK_IN_EARLY_MINUTES = 15`) y cartel `"Hora de entrada a las XX:XX"` antes de esa ventana.
- **CONFIRMADO:** Asignación de horas extra en las tablas de puestos/turnos laborales para un trabajador en un turno específico (`Shift.authorizedOvertimeMinutes`).
- **DEFAULT(overtime-cap):** `overtimeMinutes` liquidable = `min(rawOvertimeMinutes, authorizedOvertimeMinutes)` si tiene horas extras asignadas, o `0` si no tenía asignación (conservando `rawOvertimeMinutes` para auditoría).
- **DEFAULT(early-in-pay):** Los minutos fichados dentro de la ventana de hasta 15 min antes de `startsAt` se alinean a `shift.startsAt` para no contar como horas extras.
