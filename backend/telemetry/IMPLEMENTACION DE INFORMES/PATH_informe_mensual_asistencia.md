# PATH — Informe 2: Informe Mensual de Asistencia por Trabajador (JSON + PDF)

> **Objetivo:** Implementar el **2do Informe (Final de Mes)** en `backend/telemetry` para informar al **`owner`** y a los **trabajadores asignados por el `owner`** (`ReportRecipient.receiveMonthly === true`) el resumen por trabajador de un período `YYYY-MM`:
> - **Asistencias** (turnos asignados, jornadas cerradas, llegadas tarde, horas trabajadas regulares y horas extras).
> - **Ausencias** (cantidad y fechas/turnos sin fichada de entrada).
> - **Fichajes fraudulentos** (cantidad y detalle de fichadas fuera de geocerca).
> - **Salidas faltantes pendientes** (`MISSING_CLOCK_OUT`).
> Incluye consulta JSON (resumen + detalle por trabajador), **exportación en PDF** y generación automática a fin de mes.

**Prerrequisitos obligatorios:**
- [`PATH_fichado_salida_y_horas_extras.md`](./PATH_fichado_salida_y_horas_extras.md)
- [`PATH_sincronizacion_y_tarifas_puestos_empleados.md`](./PATH_sincronizacion_y_tarifas_puestos_empleados.md)
- [`PATH_informe_diario.md`](./PATH_informe_diario.md) (reutiliza `timezone-range.ts` y `PdfReportExporter`)

---

## 1. Reglas de Negocio del Informe Mensual

1. **Acceso y Destinatarios:**
   - **Plan:** Disponible en plan `basic` y `pro` (informe operativo sin montos salariales; la liquidación de pagos en Excel del Informe 3 es exclusiva de `PRO`).
   - **Quién accede / lo recibe:** El `owner` siempre, más cualquier usuario/trabajador asignado por el `owner` con `receiveMonthly = true` en `ReportRecipient`. Cualquier otro usuario recibe `403 forbidden`.
2. **Período (`period: YYYY-MM`) y Zonas Horarias:**
   - Límites `[periodStart, periodEnd)` evaluados en la zona horaria IANA de cada sede (`SiteSnapshot.timezone`).
   - Un turno pertenece al mes si su `startsAt` cae dentro del rango de su sede.
   - Si el mes está en curso (`now < periodEnd`), los turnos futuros (`startsAt > now`) se separan en `upcomingShiftsCount` para no contarlos como ausencias.
3. **Métricas por Trabajador:**
   - `employeeId`, `employeeNumber` (legajo), `firstName`, `lastName`, `fullName`, `isActive`.
   - `totalAssignedShifts` (turnos asignados transcurridos hasta `now` o cierre de mes).
   - `attendedShifts` (turnos con `IN`), `closedWorkdays`, `openWorkdays`, `missingClockOutCount`, `absentCount`.
   - `lateArrivalsCount`, `totalLateMinutes`.
   - `totalWorkedMinutes`, `totalRegularMinutes`, `totalOvertimeMinutes` (ya respetando horas extras asignadas en turnos del puesto y verificadas con `OUT`), más `totalRawOvertimeMinutes` como dato informativo.
   - `outOfGeofenceCount` (fichajes fraudulentos totales), `outOfGeofenceShiftsCount`, `maxDistanceMeters`.
4. **Exportación PDF y Drill-Down:**
   - `GET /api/v1/telemetry/reports/monthly/pdf` genera el PDF mensual con:
     - Resumen de indicadores del período.
     - Tabla consolidada por trabajador (Legajo, Trabajador, Turnos, Asistencias, Ausencias, Salidas Faltantes, Tardanzas, Horas Regulares, Horas Extras, Fichajes Fraudulentos).
     - Anexo con el listado de fichajes fraudulentos y ausencias del mes.
   - `GET /api/v1/telemetry/reports/monthly/:employeeId` devuelve el detalle turno por turno de un trabajador para auditoría en pantalla.

---

## 2. Fases y Pasos de Implementación

### Fase 0 — Patrones e Índices de Base de Datos
Commits: —

- [ ] **MEN-0.1** Agregar patrones en `backend/telemetry/src/reports/reports.patterns.ts`:
  - `attendance.report.monthly.get`
  - `attendance.report.monthly.pdf`
  - `attendance.report.monthly.employee-detail`
  - `attendance.report.monthly.history`
  - Evento emitido: `MONTHLY_REPORT_READY: 'monthly_report_ready'`
  - Check: Constantes exportadas sin strings literales dispersos.
- [ ] **MEN-0.2** Verificar índice en `ShiftSnapshot` (`backend/telemetry/src/prisma/schema.prisma`, `teamworkflow-postgres`):
  - Agregar `@@index([tenantId, startsAt], map: "idx_shift_snapshot_tenant_starts")` en su propia migración (`CREATE INDEX CONCURRENTLY` si la tabla ya existe en producción, siguiendo `skills/teamworkflow-prisma-migrations`).
  - Check: `prisma validate` pasa; plan de consulta usa índice al filtrar 1 mes completo de un tenant.

---

### Fase 1 — Persistencia de Snapshots Mensuales (`schema.prisma`)
Commits: —

- [ ] **MEN-1.1** Agregar modelo `MonthlyAttendanceReport` en `backend/telemetry/src/prisma/schema.prisma`:
  - `id`, `tenantId`, `period` (`YYYY-MM`), `siteId` (nullable), `employeesCount`, `totalAttendedShifts`, `totalAbsentShifts`, `totalOutOfGeofence`, `totalMissingClockOuts`, `totalWorkedMinutes`, `totalOvertimeMinutes`, `payload` (Json), `generatedAt`.
  - Índice único parcial SQL sobre `(tenant_id, period)` donde `site_id IS NULL`.
  - Actualizar `BillingConsumer.handleDataRetentionExpired` para purgar `monthlyAttendanceReport`.
  - Check: `prisma validate` y `prisma:attendance:generate` pasan.

---

### Fase 2 — Agregador Puro y Generador PDF Mensual (`reports/domain`, `reports/export`)
Commits: —

- [ ] **MEN-2.1** Implementar `buildMonthlyAttendanceReport(...)` (`backend/telemetry/src/reports/domain/monthly-report-builder.ts`):
  - Agrupa por `employeeId` todos los turnos asignados no cancelados, sus `Workday` y `ClockEvent` (incluyendo los eventos `outOfGeofence === true`), calculando métricas mensuales y el detalle cronológico por turno (`shiftsByEmployee`).
  - Maneja determinísticamente turnos terminados sin `Workday` como `ABSENT`, y turnos con `MISSING_CLOCK_OUT` como asistidos con `0` min computables y advertencia.
  - Check: `monthly-report-builder.spec.ts` cubre casos tabulares (asistencias, ausencias, tardanzas, extras asignadas y cumplidas, `MISSING_CLOCK_OUT`, múltiples sedes/puestos, turnos futuros en mes abierto y múltiples fichajes fraudulentos).
- [ ] **MEN-2.2** Ampliar `PdfReportExporter` (`src/reports/export/pdf-report-exporter.ts`) con `generateMonthlyPdf(reportData): Promise<Buffer>`:
  - Tabla principal por trabajador + sección de detalle de ausencias y fichajes fuera de geocerca.
  - Sanitización de texto y paginación automática.
  - Check: `pdf-report-exporter.spec.ts` genera un PDF válido (`%PDF-`) con casos vacíos y múltiples páginas.

---

### Fase 3 — Servicio y Controlador HTTP
Commits: —

- [ ] **MEN-3.1** Implementar `MonthlyReportsService` (`backend/telemetry/src/reports/monthly-reports.service.ts`):
  - Valida autorización vía `reportRecipients.authorizeReportAccess(actor, 'monthly')`.
  - Valida formato `period` (`YYYY-MM`, `422`), pertenencia de `siteId`/`employeeId` al `actor.tenantId` (`404` si es de otro tenant).
  - Expone `getMonthlyReport`, `exportMonthlyPdf`, `getEmployeeMonthlyDetail`, `generateAndSaveMonthlySnapshot` y `listMonthlyHistory`.
  - Check: `monthly-reports.service.spec.ts` verifica autorización (`owner` vs asignado vs no asignado -> 403), aislamiento cross-tenant (`404`) y exactitud de agregaciones.
- [ ] **MEN-3.2** Registrar rutas en `ReportsController` (`src/reports/reports.controller.ts`):
  - `GET /reports/monthly` (`?period=YYYY-MM&siteId=...&employeeId=...`)
  - `GET /reports/monthly/pdf` (`?period=YYYY-MM&siteId=...&employeeId=...`) -> `application/pdf`, `Content-Disposition: attachment; filename="informe-mensual-YYYY-MM.pdf"`
  - `GET /reports/monthly/history`
  - `GET /reports/monthly/:employeeId` *(declarada después de `/pdf`, `/history` y `/export` para evitar colisión de rutas en NestJS)*
  - Check: `reports.controller.spec.ts` verifica prioridad de rutas, headers PDF, validación de query (`422`) y permisos (`403`).

---

### Fase 4 — Job Automático de Fin de Mes y Notificación
Commits: —

- [ ] **MEN-4.1** Crear `MonthlyReportJob` (`backend/telemetry/src/reports/jobs/monthly-report.job.ts`):
  - Corre el **día 1 de cada mes a las 04:00** en `DEFAULT_REPORT_TZ` (luego de `WorkdaysMonitorJob` y del margen de +2 h para cierres de turno de fin de mes), con método `tick(overrideNow?: Date)` testeable.
  - Omite tenants en `TenantState.isSuspended === true`.
  - Guarda `MonthlyAttendanceReport` idempotente para el período anterior.
  - Resuelve `recipientUserIds = await reportRecipients.resolveNotificationRecipientUserIds(tenantId, 'monthly')` y emite `t.<tenant>.attendance.monthly_report_ready`.
  - Check: `monthly-report.job.spec.ts` prueba cierre del mes anterior (`2026-12-01` -> `2026-11`), idempotencia, skip de suspendidos e inclusión de `recipientUserIds`.
- [ ] **MEN-4.2** Integración en `core/notifications`:
  - Suscribir `t.*.attendance.monthly_report_ready` en `notifications-telemetry`.
  - Agregar plantilla `monthly_attendance_report` en `template-registry.ts` (español).
  - En `ConsumedEventsProcessor`: resolver `owner` (`authService.listRecipients({ tenantId, roles: ['owner'] })`) + `payload.recipientUserIds` deduplicados y despachar notificación in-app + push.
  - Check: Tests en `backend/core/src/notifications/` verifican entrega al `owner` y asignados únicamente.

---

### Fase 5 — Done Checks
Commits: —

- [ ] **MEN-5.1** Actualizar `backend/telemetry/AGENTS.md` y `backend/core/src/notifications/AGENTS.md`.
- [ ] **MEN-5.2** Agregar E2E `backend/telemetry/test/reports-monthly.e2e-spec.ts` cubriendo JSON, descarga PDF, drill-down, permisos de `owner` vs trabajador asignado vs no asignado, y aislamiento multi-tenant.
  - Check: `pnpm lint`, `pnpm test`, `pnpm build` (y `test:e2e`) pasan.

---

## Decisions & Defaults to Confirm

- **CONFIRMADO:** El Informe Mensual (JSON + PDF) llega al **`owner`** y a los trabajadores asignados por el `owner` con `receiveMonthly = true`.
- **CONFIRMADO:** Disponible en plan `basic` y `pro`.
- **TODO(pdf-dep):** Reutiliza la misma librería `pdfkit` de `PATH_informe_diario.md` (requiere autorización explícita antes de instalar).
- **DEFAULT(monthly-report-job-hour):** Ejecución automática el día 1 de cada mes a las `04:00` en `DEFAULT_REPORT_TZ`.
