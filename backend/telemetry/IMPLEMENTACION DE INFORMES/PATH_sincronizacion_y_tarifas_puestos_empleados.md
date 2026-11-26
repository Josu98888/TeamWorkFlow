# PATH — Sincronización de Metadatos, Tarifas (Empleado/Puesto), Destinatarios y Plan `PRO`

> **Objetivo:**
> 1. Replicar en `backend/telemetry` los metadatos de Sedes (`SiteSnapshot` con `timezone` IANA), Puestos (`PostSnapshot`) y Empleados (`EmployeeSnapshot`) desde `core/organization` sin romper el aislamiento de schemas.
> 2. Implementar la configuración de tarifas:
>    - **Precio por hora o precio por jornada de cada empleado** (`EmployeeCompensation`: `HOURLY` | `PER_SHIFT`).
>    - **Precio de horas extras por puesto** (`PostOvertimeRate`: `overtimeHourlyRate` por `postId`).
> 3. Implementar la gestión de **destinatarios de informes asignados por el `owner`** (`ReportRecipient`), para definir qué trabajadores/usuarios reciben y consultan los PDFs y el Excel.
> 4. Habilitar la feature **`payroll_reports`** en **`core/billing` (solo plan `PRO`)** y en `AuthGuard`/`TenantStateService` de `telemetry` para restringir los informes de pagos en Excel a clientes `PRO`.

---

## 1. Arquitectura de Datos, Acceso y Plan `PRO`

1. **Aislamiento de schemas:** `telemetry` (`attendance_svc`) no consulta `organization` ni `billing` directamente. Consume eventos JetStream y usa NATS request-reply como fallback (`OrganizationResponder`).
2. **Plan `PRO` (`payroll_reports`):**
   - Hoy `backend/core/src/billing/prisma/seed-plans.ts` define:
     - `BASIC`: `{ tasks: false, alerts: false, tower: false }`
     - `PRO`: `{ tasks: true, alerts: true, tower: true }`
   - Se agrega `payroll_reports`:
     - `BASIC`: `{ ..., payroll_reports: false }`
     - `PRO`: `{ ..., payroll_reports: true }`
   - Los informes operativos diarios y mensuales de asistencia (Informes 1 y 2) funcionan en `BASIC` y `PRO`; **los endpoints de liquidación de pagos y descarga Excel (Informe 3)** requieren `@RequireFeature('payroll_reports')` (si es `BASIC`, responde `403 feature_not_in_plan`).
3. **Destinatarios de informes (`owner` + asignados):**
   - El **`owner`** siempre tiene acceso completo y gestiona qué usuarios/trabajadores (`userId`) del tenant están habilitados para recibir y consultar cada tipo de informe (`ReportRecipient`: `receiveDaily`, `receiveMonthly`, `receivePayrollExcel`).
   - Los administradores/encargados de RRHH o trabajadores designados por el `owner` en `ReportRecipient` obtienen permiso en `telemetry` aunque su rol operativo en `auth` sea `admin`, `supervisor` o `employee` (con bloqueo estricto si `isActive = false` o fuera del tenant).

---

## 2. Fases y Pasos de Implementación

### Fase 0 — Contratos entre `core` y `telemetry`
Commits: —

- [ ] **CFG-0.1** Actualizar contratos en `backend/core/AGENTS.md`, `backend/core/src/organization/AGENTS.md`, `backend/core/src/billing/AGENTS.md`, `backend/telemetry/AGENTS.md` y `docs/architecture.md`:
  - `organization` NATS responders: agregar `organization.site.list`, `organization.post.list`, `organization.employee.list`, ampliar `organization.employee.get` (`userId` o `employeeId`) y sumar `timezone` + `isActive` en `TelemetrySiteDto`, `employeeNumber` + `isActive` en `TelemetryEmployeeDto` y `authorizedOvertimeMinutes` en `TelemetryShiftDto`.
  - `organization` JetStream events: agregar `employee_updated`, `post_created`, `post_updated`, e incluir `name`/`timezone`/`isActive` en `site_updated`.
  - `billing` features: documentar `payroll_reports` (`false` en `BASIC`, `true` en `PRO`).
  - Check: Documentos de contrato sincronizados entre ambos servicios.

---

### Fase 1 — Cambios en `core/billing` (Feature `payroll_reports` en Plan `PRO`)
Commits: —

- [ ] **CFG-1.1** Actualizar `backend/core/src/billing/prisma/seed-plans.ts`:
  - `BASIC.features`: `{ tasks: false, alerts: false, tower: false, payroll_reports: false }`
  - `PRO.features`: `{ tasks: true, alerts: true, tower: true, payroll_reports: true }`
  - Check: `seed-plans` es idempotente y actualiza el `Json features` en `Plan`.
- [ ] **CFG-1.2** Crear script/migración de datos segura (o backfill idempotente en `billing`) para actualizar los `Tenant.features` en `auth` de tenants ya existentes en plan `PRO`/`TRIAL` (emitiendo o sincronizando el feature `payroll_reports: true` en `PRO` y `false` en `BASIC`).
  - Check: Tenants `PRO` obtienen `features.payroll_reports === true` desde `auth.token.verify` y en `TenantFeatures` de `telemetry`.

---

### Fase 2 — Ampliación de `core/organization` (Responders y Eventos)
Commits: —

- [ ] **CFG-2.1** Actualizar `organization.patterns.ts`, `SitesService`, `PostsService`, `EmployeesService` y `UserCreatedHandler`:
  - Emitir `site_updated` con `name`, `timezone`, `isActive`.
  - Emitir `post_created` / `post_updated` con `{ postId, tenantId, siteId, name, isActive }`.
  - Emitir `employee_created` (incluyendo `employeeNumber`, `isActive`) y `employee_updated` (incluyendo `userId`, `firstName`, `lastName`, `employeeNumber`, `isActive`) al editar o vincular `userId`.
  - Check: Unit tests en `backend/core/src/organization/` verifican emisiones post-commit sin filtrar `nationalId`, `phone` o datos sensibles.
- [ ] **CFG-2.2** Ampliar `OrganizationService` y `OrganizationResponder` (`src/organization/responders/`):
  - Agregar responders `organization.site.list`, `organization.post.list`, `organization.employee.list` y lookup por `employeeId` en `organization.employee.get`, todos con `tenantId` validado como UUID y mapper sin PII (`telemetry-wire.ts`).
  - Check: `organization.responder.spec.ts` verifica aislamiento entre tenants y ausencia de campos prohibidos.

---

### Fase 3 — Modelo de Datos en `telemetry` (`schema.prisma` + Migración)
Commits: —

- [ ] **CFG-3.1** Agregar snapshots locales en `backend/telemetry/src/prisma/schema.prisma`:
  - `SiteSnapshot`: `siteId @id`, `tenantId`, `name`, `timezone`, `isActive`, `updatedAt`.
  - `PostSnapshot`: `postId @id`, `tenantId`, `siteId`, `name`, `isActive`, `updatedAt`.
  - `EmployeeSnapshot`: `employeeId @id`, `tenantId`, `userId?`, `firstName`, `lastName`, `employeeNumber?`, `isActive`, `updatedAt`. Unique `(tenantId, userId)`.
  - Check: `prisma validate` pasa.
- [ ] **CFG-3.2** Agregar modelos de tarifas y destinatarios en `backend/telemetry/src/prisma/schema.prisma`:
  - Enum `PayRateType`: `HOURLY`, `PER_SHIFT` (`@@map("pay_rate_type")`).
  - `EmployeeCompensation`: `id`, `tenantId`, `employeeId`, `payType`, `baseRate Decimal @db.Decimal(12, 2)`, `currency @default("ARS")`, `updatedByUserId`, `createdAt`, `updatedAt`. Unique `(tenantId, employeeId)`.
  - `PostOvertimeRate`: `id`, `tenantId`, `postId`, `siteId`, `overtimeHourlyRate Decimal @db.Decimal(12, 2)`, `currency @default("ARS")`, `updatedByUserId`, `createdAt`, `updatedAt`. Unique `(tenantId, postId)`.
  - `CompensationChangeLog`: auditoría de cambios de tarifas (`id`, `tenantId`, `targetType`, `targetId`, `before Json?`, `after Json`, `changedByUserId`, `reason?`, `createdAt`).
  - `ReportRecipient`:
    - `id String @id @default(uuid(7)) @db.Uuid`
    - `tenantId String @map("tenant_id") @db.Uuid`
    - `userId String @map("user_id") @db.Uuid` (referencia al usuario asignado por el `owner`)
    - `employeeId String? @map("employee_id") @db.Uuid` (opcional para mostrar nombre/legajo desde `EmployeeSnapshot`)
    - `receiveDaily Boolean @default(true) @map("receive_daily")`
    - `receiveMonthly Boolean @default(true) @map("receive_monthly")`
    - `receivePayrollExcel Boolean @default(false) @map("receive_payroll_excel")`
    - `assignedByUserId String @map("assigned_by_user_id") @db.Uuid`
    - `createdAt`, `updatedAt`
    - `@@unique([tenantId, userId], map: "uq_report_recipient_tenant_user")`
    - `@@map("report_recipients")`
  - Check: `prisma validate` pasa; migración incluye `CHECK (base_rate >= 0)` y `CHECK (overtime_hourly_rate >= 0)`; `BillingConsumer.handleDataRetentionExpired` purga todas estas tablas por `tenantId`.

---

### Fase 4 — Sincronización de Snapshots y Plan Gating en `telemetry`
Commits: —

- [ ] **CFG-4.1** Actualizar `AuthGuard` (`backend/telemetry/src/http/guards/auth.guard.ts`) y `TenantStateService` (`backend/telemetry/src/tenants/tenant-state.service.ts`):
  - Ampliar `hasFeature(tenantId, feature: 'alerts' | 'tower' | 'payroll_reports')`.
  - En `AuthGuard.canActivate` línea 144: incluir `'payroll_reports'` en la consulta de fallback a `tenantState.hasFeature` cuando el actor del fallback local no incluya `features`.
  - Check: `auth.guard.spec.ts` y `tenant-state.service.spec.ts` verifican que rutas con `@RequireFeature('payroll_reports')` responden `403 feature_not_in_plan` en plan `basic` y permiten el paso en plan `pro`.
- [ ] **CFG-4.2** Crear `OrgSnapshotsService` (`src/snapshots/org-snapshots.service.ts`) y suscribir `employee_created`, `employee_updated`, `post_created`, `post_updated` en `OrganizationConsumer`:
  - `ensureTenantCatalogSynced(tenantId)` realiza backfill paginado vía `NatsClientService` si hay datos faltantes.
  - Check: `org-snapshots.service.spec.ts` y `organization.handler.spec.ts` prueban sincronización idempotente e inmutabilidad ante tenant mismatch.

---

### Fase 5 — Módulo `compensation` (Tarifas) y Gestión de Destinatarios (`ReportRecipient`)
Commits: —

- [ ] **CFG-5.1** Implementar `CompensationService` y `CompensationController` (`/api/v1/telemetry/compensation`):
  - **Acceso:** `@Roles('owner', 'admin')` para consultar/editar tarifas (o restringible también a usuarios con `receivePayrollExcel` solo lectura).
  - **Rutas:**
    - `GET /compensation/employees` (lista todos los empleados con su `payType` y `baseRate`, destacando los sin configurar).
    - `PUT /compensation/employees/:employeeId` (configura precio por hora `hourly` o por jornada `per_shift` + `baseRate`, con auditoría en `CompensationChangeLog`).
    - `GET /compensation/posts` (lista todos los puestos con su sede y `overtimeHourlyRate`).
    - `PUT /compensation/posts/:postId` (configura precio de horas extras del puesto).
    - `GET /compensation/history` (historial de modificaciones de tarifas).
  - **Regla de dinero:** validar `baseRate` y `overtimeHourlyRate` con regex decimal (`^\d{1,10}(\.\d{1,2})?$`), almacenar y calcular con `Prisma.Decimal`, devolver strings `"12500.00"`.
  - Check: `compensation.service.spec.ts` y `compensation.controller.spec.ts` prueban validación decimal, 404 cross-tenant, 403 para `employee`/`supervisor`/`platform_admin` y auditoría.
- [ ] **CFG-5.2** Implementar `ReportRecipientsService` y `ReportRecipientsController` (`/api/v1/telemetry/reports/recipients`):
  - **Gestión exclusiva del `owner`:** `@Roles('owner')` en `GET /reports/recipients`, `PUT /reports/recipients/:userId`, `DELETE /reports/recipients/:userId`.
  - Valida que el `userId` asignado pertenezca al mismo `tenantId` y esté activo (`EmployeeSnapshot` con `userId` vinculado e `isActive: true`). El `owner` no puede auto-eliminarse como destinatario principal.
  - Exponer método interno `authorizeReportAccess(actor, reportKind: 'daily' | 'monthly' | 'payroll_excel')` usado por todos los servicios de informes:
    - Si `actor.role === 'owner'` -> permitido siempre.
    - Si existe fila en `ReportRecipient` para `(actor.tenantId, actor.userId)` con el flag correspondiente en `true` -> permitido.
    - Caso contrario -> `403 forbidden`.
  - Exponer método interno `resolveNotificationRecipientUserIds(tenantId, reportKind)` (devuelve todos los `userId` asignados para ese tipo de reporte, para que el evento JetStream hacia `notifications` incluya al `owner` más los trabajadores asignados!).
  - Check: `report-recipients.service.spec.ts` y `report-recipients.controller.spec.ts` prueban: solo `owner` puede asignar/quitar destinatarios (`admin`, `supervisor`, `employee` reciben `403`), usuario asignado puede acceder solo a los tipos habilitados, usuario de otro tenant es rechazado (`404`/`422`), y usuario desactivado en `EmployeeSnapshot` pierde acceso automáticamente.

---

### Fase 6 — Done Checks
Commits: —

- [ ] **CFG-6.1** Ejecutar `pnpm lint`, `pnpm test` y `pnpm build` en `backend/core` y `backend/telemetry`, verificando aislamiento multi-tenant, purga en `data_retention_expired` y feature gating `payroll_reports`.
  - Check: 100% de tests unitarios y builds pasando.

---

## Decisions & Defaults to Confirm

- **CONFIRMADO:** Solo el **`owner`** asigna qué trabajadores (`userId`) reciben y acceden a los informes (`ReportRecipient`).
- **CONFIRMADO:** El acceso a los informes de pagos en Excel está restringido a tenants con plan **`PRO`** (`features.payroll_reports === true`).
- **DEFAULT(compensation-access):** Tanto `owner` como `admin` (si el `owner` lo habilita o por rol `admin`) pueden cargar las tarifas de empleados y puestos en `CompensationController`; los endpoints de descarga de pagos Excel además exigen plan `PRO` y autorización de destinatario (`owner` o `ReportRecipient.receivePayrollExcel`).
- **DEFAULT(compensation-missing-rate):** Si un empleado o puesto no tiene tarifa cargada, los listados lo marcan como pendiente (`null`) y el cálculo Excel informa advertencia sin fallar con error 500.
