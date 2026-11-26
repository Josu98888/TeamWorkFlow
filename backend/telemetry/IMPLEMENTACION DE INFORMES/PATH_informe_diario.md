# PATH — Informe 1: Informe Diario (JSON + PDF) de Ausentes y Fichajes Fuera de Geocerca

> **Objetivo:** Implementar el **1er Informe (Diario)** en `backend/telemetry` para informar al **`owner`** y a los **trabajadores asignados por el `owner`** (`ReportRecipient.receiveDaily === true`):
> 1. **Trabajadores ausentes en la jornada** del día.
> 2. **Trabajadores que ficharon fuera de la geocerca** (registros fraudulentos con distancia en metros y estado de alerta).
> Incluye consulta JSON, **exportación en PDF**, generación automática diaria y notificación al `owner` y asignados.

**Prerrequisitos obligatorios:**
- [`PATH_fichado_salida_y_horas_extras.md`](./PATH_fichado_salida_y_horas_extras.md) (estado `ABSENT`, campos de `Workday`, `CLOCK_IN_EARLY_MINUTES = 15`).
- [`PATH_sincronizacion_y_tarifas_puestos_empleados.md`](./PATH_sincronizacion_y_tarifas_puestos_empleados.md) (`SiteSnapshot` con `timezone`, `PostSnapshot`, `EmployeeSnapshot`, `ReportRecipient`).

---

## 1. Reglas de Negocio del Informe Diario

1. **Acceso y Destinatarios:**
   - **Plan:** Disponible en plan `basic` y `pro` (no es exclusivo de pagos Excel).
   - **Quién accede / lo recibe:** El `owner` siempre, más cualquier trabajador/usuario asignado por el `owner` con `receiveDaily = true` en `ReportRecipient` (`reportRecipients.authorizeReportAccess(actor, 'daily')`). Cualquier otro usuario (incluyendo `admin` o `supervisor` no asignados por el `owner`, y `platform_admin`) recibe `403 forbidden`.
2. **Definición de la jornada del día (`date: YYYY-MM-DD`):**
   - Cada sede se evalúa en su **zona horaria IANA** (`SiteSnapshot.timezone`, p. ej. `America/Argentina/Buenos_Aires`), tomando `[YYYY-MM-DD 00:00:00, YYYY-MM-DD+1 00:00:00)` convertido a UTC.
   - Si no se envía `date`, se usa la fecha actual en `DEFAULT_REPORT_TZ` (o la timezone de la sede si se filtra `siteId`).
3. **Trabajadores Ausentes (`absences`):**
   - Turnos no cancelados en `ShiftSnapshot` del día con `employeeId != null` y cero eventos `ClockEvent` de tipo `IN`:
     - Turno ya finalizado (`endsAt <= now` o `Workday.status === 'ABSENT'`): `CONFIRMED_ABSENCE`.
     - Turno en curso que ya superó los 15 min desde `startsAt` (`now >= startsAt + 15 min`) sin `IN`: `IN_PROGRESS_NO_SHOW`.
   - Turnos sin asignar (`employeeId == null`) no se mezclan en `absences`: se informan por separado en `summary.unassignedShiftsCount`.
4. **Fichajes Fraudulentos / Fuera de Geocerca (`outOfGeofenceEvents`):**
   - Todo `ClockEvent` del día en la sede con `outOfGeofence === true` (registrado por GPS fuera del radio sin QR válido).
   - Incluye: `clockEventId`, `shiftId`, `employeeId`, `employeeName`, `employeeNumber`, `siteId`, `siteName`, `postId`, `postName`, `type` (`IN | OUT | BREAK_START | BREAK_END`), `method`, `deviceTime`, `distanceMeters`, `alertId`, `alertStatus`.
   - Seguridad en logs: nunca loguear coordenadas GPS junto al nombre del empleado.
5. **Salida en PDF y JSON:**
   - Endpoint JSON para visualización rápida en la web (`GET /api/v1/telemetry/reports/daily`).
   - Endpoint **PDF descargable** (`GET /api/v1/telemetry/reports/daily/pdf`) con diseño tabular limpio (encabezado de empresa/fecha, resumen ejecutivo de KPIs, tabla de trabajadores ausentes y tabla de fichajes fuera de geocerca) para descargar o adjuntar desde el panel o desde la notificación!

---

## 2. Fases y Pasos de Implementación

### Fase 0 — Contratos, Dependencia PDF y Configuración
Commits: —

- [ ] **DIA-0.1** **PREVIA APROBACIÓN DEL USUARIO (`/STEPS.rules.md` §6):**
  - `TODO(pdf-dep)`: Solicitar autorización para instalar `pdfkit` y `@types/pdfkit` en `backend/telemetry/` para generar el PDF del Informe 1 y del Informe 2 sin levantar un navegador headless (alternativa más liviana y rápida en contenedor Node).
  - Check: `pnpm ls pdfkit` confirma instalación tras aprobación; `pnpm build` pasa.
- [ ] **DIA-0.2** Definir constantes en `backend/telemetry/src/reports/reports.patterns.ts`:
  - `attendance.report.daily.get`
  - `attendance.report.daily.pdf`
  - `attendance.report.daily.history`
  - Evento emitido: `DAILY_REPORT_READY: 'daily_report_ready'`
  - Check: Constantes exportadas y documentadas en `backend/telemetry/AGENTS.md`.
- [ ] **DIA-0.3** Agregar `DEFAULT_REPORT_TZ` (default `'America/Argentina/Buenos_Aires'`) en `src/config/env.schema.ts`, `envs.ts` y `.env.example`.
  - Check: `envs.spec.ts` valida IANA timezone.

---

### Fase 1 — Persistencia de Snapshots Diarios (`schema.prisma`)
Commits: —

- [ ] **DIA-1.1** Agregar modelo `DailyAttendanceReport` en `backend/telemetry/src/prisma/schema.prisma`:
  - `id`, `tenantId`, `reportDate` (`YYYY-MM-DD`), `siteId` (nullable), `totalAssignedShifts`, `attendedShifts`, `absentCount`, `outOfGeofenceCount`, `missingClockOutCount`, `payload` (Json con `absences` y `outOfGeofenceEvents`), `generatedAt`.
  - Índice único parcial SQL sobre `(tenant_id, report_date)` donde `site_id IS NULL`.
  - Actualizar `BillingConsumer.handleDataRetentionExpired` para purgar `dailyAttendanceReport`.
  - Check: `prisma validate` pasa; migración revisada y `prisma:attendance:generate` ejecutado.

---

### Fase 2 — Dominio Puro y Generador PDF (`reports/domain`, `reports/export`)
Commits: —

- [ ] **DIA-2.1** Implementar `timezone-range.ts` (`dayRange(date, ianaTz)` y `monthRange(period, ianaTz)` usando `Intl.DateTimeFormat`) y `buildDailyReportPayload(...)` (`daily-report-builder.ts`).
  - Check: `timezone-range.spec.ts` y `daily-report-builder.spec.ts` prueban zonas horarias, ausentes, turnos cancelados ignorados, turnos sin asignar separados, y eventos `outOfGeofence`.
- [ ] **DIA-2.2** Implementar `PdfReportExporter` (`backend/telemetry/src/reports/export/pdf-report-exporter.ts`):
  - Método `generateDailyPdf(reportData): Promise<Buffer>`:
    - Encabezado con título `Informe Diario de Asistencia`, fecha, sede/filtro y timestamp de generación.
    - Bloque de totales (`Turnos asignados`, `Presentes`, `Ausentes`, `Fichajes fuera de geocerca`, `Salidas sin fichar`).
    - Tabla 1: `Trabajadores Ausentes` (Legajo, Nombre, Sede, Puesto, Horario turno, Estado).
    - Tabla 2: `Fichajes Fraudulentos (Fuera de Geocerca)` (Hora, Legajo, Nombre, Sede, Puesto, Tipo, Distancia (m), Estado Alerta).
    - Paginación automática si las tablas superan 1 página y sanitización de texto.
  - Check: `pdf-report-exporter.spec.ts` verifica que el `Buffer` comienza con la cabecera `%PDF-` y no falla con listas vacías ni cientos de filas.

---

### Fase 3 — Servicio y Controlador HTTP (`DailyReportsService` & `ReportsController`)
Commits: —

- [ ] **DIA-3.1** Implementar `DailyReportsService` (`backend/telemetry/src/reports/daily-reports.service.ts`):
  - En cada método de lectura/descarga, llamar primero a `reportRecipients.authorizeReportAccess(actor, 'daily')`.
  - Validar `siteId` contra `SiteSnapshot` del `actor.tenantId` (404 `site_not_found` si pertenece a otro tenant).
  - Construir reporte en vivo desde `ShiftSnapshot`, `ClockEvent`, `Workday`, `Alert` y snapshots de organización filtrando por `actor.tenantId`.
  - `exportDailyPdf(actor, query)` devuelve `{ buffer, filename: 'informe-diario-YYYY-MM-DD.pdf' }`.
  - Check: `daily-reports.service.spec.ts` verifica: `owner` accede, trabajador asignado con `receiveDaily: true` accede, usuario con `receiveDaily: false` o sin asignar recibe `403`, y aislamiento total cross-tenant.
- [ ] **DIA-3.2** Exponer en `ReportsController` (`/api/v1/telemetry/reports`):
  - `GET /reports/daily` (`?date=YYYY-MM-DD&siteId=...`) -> JSON del informe diario.
  - `GET /reports/daily/pdf` (`?date=YYYY-MM-DD&siteId=...`) -> descarga PDF (`application/pdf`, `Content-Disposition: attachment; filename="informe-diario-YYYY-MM-DD.pdf"`, `Cache-Control: no-store`).
  - `GET /reports/daily/history` -> historial paginado de cierres diarios.
  - **CORS (`src/app.config.ts`):** exponer header `Content-Disposition`.
  - Check: `reports.controller.spec.ts` valida headers PDF, status `422` ante fecha inválida y `403` ante usuario no autorizado.

---

### Fase 4 — Job Diario Automático y Notificación al `owner` + Asignados
Commits: —

- [ ] **DIA-4.1** Crear `DailyReportJob` (`backend/telemetry/src/reports/jobs/daily-report.job.ts`):
  - Corre diariamente al cierre del día anterior (p. ej. `@Cron('15 0 * * *')` o chequeo horario por zona horaria), omitiendo tenants en `TenantState.isSuspended === true`.
  - Guarda el snapshot `DailyAttendanceReport` idempotente.
  - Resuelve `recipientUserIds = await reportRecipients.resolveNotificationRecipientUserIds(tenantId, 'daily')` (incluye a los trabajadores habilitados por el `owner`; el consumidor de `notifications` además siempre incluye al `owner` del tenant!).
  - Publica `t.<tenant>.attendance.daily_report_ready` con `{ eventId, tenantId, reportId, reportDate, absentCount, outOfGeofenceCount, totalAssignedShifts, recipientUserIds, occurredAt }`.
  - Check: `daily-report.job.spec.ts` prueba idempotencia, exclusión de tenants suspendidos e inclusión de `recipientUserIds`.
- [ ] **DIA-4.2** Integración en `core/notifications`:
  - Suscribir `t.*.attendance.daily_report_ready` en el consumer durable `notifications-telemetry` (`notifications.events.ts`).
  - Agregar plantilla `daily_attendance_report` en `template-registry.ts` (en español, incluyendo link/referencia para abrir y descargar el PDF del día en la app).
  - En `ConsumedEventsProcessor`: resolver el `owner` del tenant (`authService.listRecipients({ tenantId, roles: ['owner'] })`) y combinar (sin duplicados) con `payload.recipientUserIds` validados dentro del tenant, enviando push + notificación in-app! *(Así garantizamos que le llega al `owner` y a los trabajadores que el `owner` asignó, y NO a otros usuarios no autorizados).*
  - Check: Tests en `backend/core/src/notifications/` verifican entrega al `owner` + `recipientUserIds` sin duplicados y sin enviar a usuarios no asignados.

---

### Fase 5 — Done Checks
Commits: —

- [ ] **DIA-5.1** Actualizar `backend/telemetry/AGENTS.md` y `backend/core/src/notifications/AGENTS.md`.
- [ ] **DIA-5.2** Agregar E2E `backend/telemetry/test/reports-daily.e2e-spec.ts` cubriendo: `owner` asignando a un trabajador como receptor, consulta JSON y descarga PDF (`200`, magic bytes `%PDF-`), acceso denegado (`403`) a trabajador no asignado, y aislamiento entre tenants.
  - Check: `pnpm lint`, `pnpm test`, `pnpm build` (y `test:e2e`) pasan.

---

## Decisions & Defaults to Confirm

- **CONFIRMADO:** El Informe Diario llega y es accesible para el **`owner`** y los trabajadores/usuarios que el `owner` haya asignado con `receiveDaily = true` en `ReportRecipient`.
- **CONFIRMADO:** Disponible tanto en plan `basic` como `pro` (solo la exportación de pagos en Excel está restringida a `pro`).
- **TODO(pdf-dep):** Solicitar autorización explícita del usuario para instalar `pdfkit` + `@types/pdfkit` en `backend/telemetry/` antes de codear `PdfReportExporter`.
- **DEFAULT(daily-report-fraud):** Registro fraudulento = `ClockEvent` con `outOfGeofence = true` (fichada GPS fuera de geocerca sin QR válido).
