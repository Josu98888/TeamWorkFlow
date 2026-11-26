# PATH — Informe 3: Archivo Excel Mensual (`.xlsx`) con Liquidación Final de Paga [Solo Plan `PRO`]

> **Objetivo:** Implementar el **3er Informe (Final de Mes en Excel `.xlsx`)** dentro de `backend/telemetry`, exclusivo para **clientes con plan `PRO` (`@RequireFeature('payroll_reports')`)**, accesible y enviado principalmente al **`owner`** y a los **trabajadores asignados por el `owner`** (`ReportRecipient.receivePayrollExcel === true`).
> Combina toda la información del 2do Informe (asistencias, ausencias, horas trabajadas, horas extras y fichajes fraudulentos) con el cálculo final de la paga de cada trabajador según:
> - Su tarifa configurada (**precio por hora** o **precio por jornada**).
> - El **precio de horas extras configurado por puesto (`postId`)**, aplicado a las horas extras asignadas en el turno específico del puesto y verificadas mediante el fichado de salida (`OUT`).

**Prerrequisitos obligatorios:**
- [`PATH_fichado_salida_y_horas_extras.md`](./PATH_fichado_salida_y_horas_extras.md)
- [`PATH_sincronizacion_y_tarifas_puestos_empleados.md`](./PATH_sincronizacion_y_tarifas_puestos_empleados.md) (`EmployeeCompensation`, `PostOvertimeRate`, `ReportRecipient`, `payroll_reports` en plan `PRO`)
- [`PATH_informe_mensual_asistencia.md`](./PATH_informe_mensual_asistencia.md)

---

## 1. Reglas de Negocio, Plan `PRO` y Precisión Monetaria

1. **Restricción de Plan `PRO` (`@RequireFeature('payroll_reports')`):**
   - Todos los endpoints de cálculo de liquidación, cierre y descarga Excel (`/reports/monthly/payroll`, `/reports/monthly/export`, `/reports/monthly/payroll-runs*`) llevan `@RequireFeature('payroll_reports')`.
   - Si el tenant está en plan `BASIC`, `AuthGuard` responde **`403 feature_not_in_plan`**.
   - El job mensual de notificación de liquidación Excel también verifica `tenantState.hasFeature(tenantId, 'payroll_reports')` antes de generar/emitir el evento de liquidación Excel.
2. **Destinatarios (`owner` + trabajadores asignados por el `owner`):**
   - Solo el `owner` y los usuarios/trabajadores habilitados en `ReportRecipient` con `receivePayrollExcel = true` pueden ver la previsualización de pagos, descargar el `.xlsx` y recibir la notificación mensual de liquidación lista. Cualquier otro rol/usuario (incluso `admin` si el `owner` no lo asignó, `supervisor`, `employee`) recibe `403 forbidden`.
3. **Cero punto flotante (`Prisma.Decimal` obligatorio):**
   - Prohibido usar `number` de JavaScript para cálculos monetarios. Usar `Prisma.Decimal` con redondeo **`ROUND_HALF_UP`** a **2 decimales** por cada jornada (`scale(2)`). Moneda `ARS`.
4. **Fórmula de Liquidación por Jornada (`Workday` + `ShiftSnapshot` + Tarifas):**
   - Solo las jornadas **`CLOSED`** generan paga:
     - `ABSENT`, `MISSING_CLOCK_OUT`, `OPEN` -> `$0.00` (con bandera `unresolvedMissingClockOut = true` si es `MISSING_CLOCK_OUT`).
   - En cada jornada `CLOSED`:
     - `regularMinutes = Math.max(0, workday.workedMinutes - workday.overtimeMinutes)`
     - `overtimeMinutes = Math.max(0, workday.overtimeMinutes)` *(ya acotado a `min(rawOvertimeMinutes, shift.authorizedOvertimeMinutes)` si tuvo horas extras asignadas al puesto en ese turno, o `0` si no tenía asignación).*
     - **Paga Base / Regular (según `EmployeeCompensation`):**
       - Sin tarifa configurada -> `regularPay = Decimal(0)`, warning `missingEmployeeRate = true`.
       - `HOURLY` (precio por hora): `Decimal(regularMinutes).div(60).mul(baseRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`.
       - `PER_SHIFT` (precio por jornada): si `workedMinutes > 0`, `Decimal(baseRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)` (1 jornada); si `0`, `0.00`.
     - **Paga Horas Extras (según `PostOvertimeRate` del `shift.postId`):**
       - Si `overtimeMinutes === 0` -> `overtimePay = Decimal(0)`.
       - Si `overtimeMinutes > 0`:
         - Sin tarifa extra configurada en el puesto -> `overtimePay = Decimal(0)`, warning `missingPostOvertimeRate = true`.
         - Con tarifa `postRate.overtimeHourlyRate`: `Decimal(overtimeMinutes).div(60).mul(postRate.overtimeHourlyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`.
     - **Total Jornada:** `shiftTotalPay = regularPay.add(overtimePay)`.
5. **Consolidación Mensual del Trabajador:**
   - Como el trabajador pudo cubrir distintos puestos durante el mes (cada uno con su precio de hora extra), el total mensual es la suma exacta de los importes ya redondeados de cada jornada cerrada:
     - `totalRegularPay = sum(shift.regularPay)`
     - `totalOvertimePay = sum(shift.overtimePay)`
     - `totalPay = totalRegularPay.add(totalOvertimePay)`

---

## 2. Estructura del Libro Excel (`.xlsx`)

Nombre de descarga: `liquidacion-asistencia-<YYYY-MM>.xlsx` (o `<YYYY-MM>-sede-<slug>.xlsx`).

### Hoja 1: `Liquidación y Asistencia` (Resumen por trabajador)
- **Encabezado:** Tenant, Período (`YYYY-MM`), Sede, Moneda (`ARS`), Fecha de generación, y advertencias si hay empleados/puestos sin tarifa o `MISSING_CLOCK_OUT` pendientes.
- **Columnas:**
  1. `Legajo`
  2. `Trabajador`
  3. `Estado` (`Activo` / `Inactivo`)
  4. `Modalidad de Pago` (`Por hora` / `Por jornada` / `Sin configurar`)
  5. `Tarifa Base (ARS)` (`"$"#,##0.00`)
  6. `Turnos Asignados`
  7. `Asistencias`
  8. `Ausencias`
  9. `Salidas Faltantes`
  10. `Llegadas Tarde`
  11. `Min. Tardanza`
  12. `Fichajes Fraudulentos (Fuera Geocerca)`
  13. `Horas Regulares`
  14. `Horas Extras Asignadas (h)`
  15. `Horas Extras Liquidadas (h)`
  16. `Total Horas Liquidadas`
  17. `Paga Base (ARS)` (`"$"#,##0.00`)
  18. `Paga Horas Extras (ARS)` (`"$"#,##0.00`)
  19. `Total a Pagar (ARS)` (`"$"#,##0.00`, negrita)
  20. `Observaciones`
- **Fila final:** `SUM(...)` en totales de turnos, asistencias, ausencias, fraudulentos, horas y montos.

### Hoja 2: `Detalle por Jornada y Puesto`
- Detalle turno por turno: `Legajo`, `Trabajador`, `Fecha`, `Sede`, `Puesto`, `Horario Programado`, `Entrada Real`, `Salida Real`, `Estado Jornada`, `Min. Tardanza`, `Fuera de Geocerca`, `Horas Regulares`, `Horas Extras Asignadas`, `Horas Extras Trabajadas`, `Horas Extras Liquidadas`, `Tarifa Base Aplicada`, `Tarifa Hora Extra Puesto`, `Paga Base (ARS)`, `Paga Extras (ARS)`, `Total Jornada (ARS)`.

### Hoja 3: `Incidencias y Fraudulentos`
- **Sección A:** Todos los fichajes fuera de geocerca del mes (`Fecha y Hora`, `Legajo`, `Trabajador`, `Sede`, `Puesto`, `Tipo Fichada`, `Método`, `Distancia (m)`, `Estado Alerta`).
- **Sección B:** Todas las ausencias del mes (`Fecha Turno`, `Sede`, `Puesto`, `Horario`, `Legajo`, `Trabajador`, `Estado`).

---

## 3. Fases y Pasos de Implementación

### Fase 0 — Instalación de `exceljs` *(AUTORIZADO por el usuario)*
Commits: —

- [ ] **XLS-0.1** Instalar `exceljs` en `backend/telemetry/` (autorización otorgada el `2026-11-22`):
  - Ejecutar `pnpm add exceljs` dentro de `backend/telemetry/` al comenzar la implementación.
  - Check: `pnpm ls exceljs`, `pnpm build` y `pnpm lint` en `backend/telemetry/` pasan.

---

### Fase 1 — Cierre Histórico de Liquidación (`schema.prisma`)
Commits: —

- [ ] **XLS-1.1** Agregar `MonthlyPayrollRun` y `MonthlyPayrollLine` en `backend/telemetry/src/prisma/schema.prisma`:
  - `MonthlyPayrollRun`: `id`, `tenantId`, `period`, `siteId?`, `currency`, `totalRegularPay Decimal(14,2)`, `totalOvertimePay Decimal(14,2)`, `totalPay Decimal(14,2)`, `warningsCount`, `generatedByUserId`, `status` (`DRAFT | CLOSED`), `createdAt`.
  - `MonthlyPayrollLine`: `id`, `tenantId`, `runId` (FK `onDelete: Cascade`), `employeeId`, `employeeName`, `employeeNumber?`, `payType?`, `baseRateApplied Decimal?(12,2)`, `assignedShifts`, `attendedShifts`, `absentShifts`, `missingClockOutShifts`, `fraudulentClockIns`, `regularMinutes`, `overtimeMinutes`, `regularPay Decimal(12,2)`, `overtimePay Decimal(12,2)`, `totalPay Decimal(12,2)`, `observations`.
  - Actualizar `BillingConsumer.handleDataRetentionExpired` para purgar `monthlyPayrollLine` y `monthlyPayrollRun`.
  - Check: `prisma validate`, migración revisada y `prisma:attendance:generate` pasan.

---

### Fase 2 — Dominio Puro de Liquidación (`payroll-calculator.ts`)
Commits: —

- [ ] **XLS-2.1** Implementar `backend/telemetry/src/reports/domain/payroll-calculator.ts` (puro TypeScript, cero I/O, cero floats):
  - Usar `Prisma.Decimal` con `Decimal.ROUND_HALF_UP` a 2 decimales por jornada.
  - Manejar `HOURLY`, `PER_SHIFT`, multi-puesto en el mismo mes, horas extras asignadas vs trabajadas, `ABSENT`, `MISSING_CLOCK_OUT` (`$0.00` + warning) y tarifas faltantes (`missingEmployeeRate`, `missingPostOvertimeRate`).
  - Check: `payroll-calculator.spec.ts` pasa con suite tabular + verificación `rg -n "Number\(" src/reports/domain/payroll-calculator.ts` sin aritmética float sobre dinero.

---

### Fase 3 — Generador Excel (`excel-payroll-exporter.ts`) y Servicio
Commits: —

- [ ] **XLS-3.1** Implementar `ExcelPayrollExporter` (`backend/telemetry/src/reports/export/excel-payroll-exporter.ts`):
  - Construye `ExcelJS.Workbook` con las 3 hojas definidas en §2.
  - Sanitización estricta contra **Excel Formula Injection** (`=`, `+`, `-`, `@`, `\t`, `\r` al inicio de textos libres).
  - Formatos `"$"#,##0.00`, encabezados congelados, filtros automáticos y anchos ajustados.
  - Check: `excel-payroll-exporter.spec.ts` genera el `.xlsx`, lo recarga con `ExcelJS` y verifica hojas, celdas, totales `SUM` y sanitización de fórmulas maliciosas.
- [ ] **XLS-3.2** Implementar `PayrollExportService` (`backend/telemetry/src/reports/payroll-export.service.ts`):
  - En cada método, validar `reportRecipients.authorizeReportAccess(actor, 'payroll_excel')` (y defensa en profundidad `tenantState.hasFeature(actor.tenantId, 'payroll_reports')`).
  - `getPayrollPreview(actor, query)` -> JSON de liquidación y advertencias.
  - `exportMonthlyPayrollExcel(actor, query)` -> `{ buffer, filename, contentType }`.
  - `closeMonthlyPayrollRun(actor, dto)` / `exportClosedRun(actor, runId)` -> congela snapshot de liquidación.
  - Emitir opcionalmente evento `t.<tenant>.attendance.payroll_report_ready` cuando se cierra o genera en plan `PRO` para notificar a `owner` y asignados (`receivePayrollExcel = true`).
  - Check: `payroll-export.service.spec.ts` verifica permiso `owner` vs asignado vs no asignado (`403`), aislamiento cross-tenant y cálculo multi-puesto.

---

### Fase 4 — Controlador HTTP (`@RequireFeature('payroll_reports')`)
Commits: —

- [ ] **XLS-4.1** Exponer rutas en `ReportsController` (`backend/telemetry/src/reports/reports.controller.ts`):
  - Todas decoradas con `@RequireFeature('payroll_reports')` (bloqueado con `403 feature_not_in_plan` en plan `BASIC`):
    - `GET /api/v1/telemetry/reports/monthly/payroll`
    - `GET /api/v1/telemetry/reports/monthly/export` -> descarga `.xlsx` (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="liquidacion-asistencia-YYYY-MM.xlsx"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`).
    - `POST /api/v1/telemetry/reports/monthly/payroll-runs`
    - `GET /api/v1/telemetry/reports/monthly/payroll-runs`
    - `GET /api/v1/telemetry/reports/monthly/payroll-runs/:runId/export`
  - **Orden de rutas:** declarar todas antes de `GET /reports/monthly/:employeeId`.
  - Check: `reports.controller.spec.ts` verifica `403 feature_not_in_plan` para tenant `BASIC`, `403 forbidden` para usuario no asignado y `200` binario para `owner`/asignado en plan `PRO`.

---

### Fase 5 — Integración `core/notifications` y `frontend/` (Nota de Alcance)
Commits: —

- [ ] **XLS-5.1** En `core/notifications`: opcionalmente agregar plantilla `payroll_report_ready` en `template-registry.ts` para avisar al `owner` y asignados con `receivePayrollExcel = true` cuando esté disponible el cierre Excel del mes (solo tenants `PRO`).
- [ ] **XLS-5.2** En `frontend/`:
  - Vista de Reportes / Liquidación mostrando Informes 1 y 2 (con botón PDF) para `basic`/`pro`, y bloqueando/mostrando badge `PRO` en la pestaña/botón de **Liquidación y Descarga Excel** para planes `basic`, habilitando `"Descargar Excel (.xlsx)"` vía `fetch` + `Blob` para tenants `pro` (`owner` y usuarios asignados).
  - Pantalla/sección `"Destinatarios de informes"` exclusiva del `owner` para asignar trabajadores.

---

### Fase 6 — Done Checks
Commits: —

- [ ] **XLS-6.1** Actualizar `backend/telemetry/AGENTS.md` con rutas, patrones, plan gating `payroll_reports`, `ReportRecipient` y reglas Excel/`Decimal`.
- [ ] **XLS-6.2** Suite E2E `backend/telemetry/test/reports-payroll-excel.e2e-spec.ts`:
  - Flujo completo: tenant `BASIC` recibe `403 feature_not_in_plan` al intentar exportar Excel; tenant `PRO` con `owner` configura tarifas (`HOURLY` y `PER_SHIFT`), configura tarifa hora extra por puesto, asigna horas extra en un turno del puesto, trabajador ficha `IN` (rechazado antes de 15 min con `"Hora de entrada a las XX:XX"`) y `OUT` (incluyendo horas extra y un `outOfGeofence`), `owner` asigna un trabajador como receptor, ambos descargan el `.xlsx` (`200`) y un trabajador no asignado recibe `403`.
  - Check: `pnpm lint`, `pnpm test`, `pnpm build` (y `test:e2e`) pasan al 100%.

---

## Decisions & Defaults to Confirm

- **CONFIRMADO:** Liquidación y descarga Excel (Informe 3) restringida al plan **`PRO`** (`@RequireFeature('payroll_reports')`).
- **CONFIRMADO:** Acceso exclusivo del **`owner`** y de los trabajadores asignados por el `owner` (`ReportRecipient.receivePayrollExcel = true`).
- **CONFIRMADO:** Autorización otorgada para instalar `exceljs` en `backend/telemetry/`.
- **DEFAULT(payroll-rounding):** Redondeo `ROUND_HALF_UP` a 2 decimales en `ARS` por cada jornada antes de sumar al total del trabajador, usando `Prisma.Decimal` exclusivamente.
- **DEFAULT(payroll-excel-security):** Todos los campos de texto libre se sanitizan contra Excel Formula Injection antes de escribirse en celdas.
