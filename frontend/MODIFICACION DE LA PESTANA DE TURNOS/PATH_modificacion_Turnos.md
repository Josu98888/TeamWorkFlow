# PATH — Modificación de la Pestaña Turnos (Estructura de Carpetas, Plantillas Semanales, Buscador Progresivo y Lista Ordenable)

> **Ubicación de este plan:** `frontend/MODIFICACION DE LA PESTANA DE TURNOS/` (simétrico a `backend/core/IMPLEMENTACION DE FACTURACION/`, `backend/core/IMPLEMENTACION DE TAREAS Y NOTIFICACIONES/` y `backend/telemetry/IMPLEMENTACION DE INFORMES/`, en la raíz de la aplicación dueña de la ruta `/turnos`).
>
> **Objetivo:** Rediseñar la pestaña **Turnos** (`frontend/app/(dashboard)/turnos/` y `frontend/features/organization/`) reemplazando la tabla plana actual (`ShiftsView.tsx`) por una **navegación jerárquica en 3 niveles tipo carpetas** (`Sedes -> Puestos de Trabajo -> Trabajadores asignados con horario y días de la semana`), con:
> 1. **Nivel 0 (Carpetas por Sede):** una carpeta por cada sede de la cuenta (ej. *Parripollo 1*).
> 2. **Nivel 1 (Carpetas por Puesto de Trabajo):** dentro de la sede, los puestos creados en *Sedes y Geocercas* (`Post`).
> 3. **Nivel 2 (Trabajadores del Puesto):** dentro del puesto, asignación de trabajadores con su **horario y días de trabajo de la semana** (`ShiftTemplate` + gestión de turnos/horas extras), mostrados en una **lista ordenable por Nombre y DNI (ascendente/descendente)**.
> 4. **Buscador contextual progresivo** en la parte superior que reduce los filtros disponibles a medida que se ingresa en cada carpeta:
>    - Nivel 0 (Raíz): filtra por **Sede**, **Puesto de Trabajo**, **Empleado** y **DNI**.
>    - Nivel 1 (Dentro de Sede): filtra por **Puesto de Trabajo**, **Empleado** y **DNI**.
>    - Nivel 2 (Dentro de Puesto): filtra por **Nombre de Empleado** y **DNI**.

---

## 1. Diagnóstico del Estado Actual (Backend y Frontend)

### 1.1 Qué existe hoy
- **Frontend (`frontend/app/(dashboard)/turnos/page.tsx` -> `frontend/features/organization/components/ShiftsView.tsx`):**
  - Muestra una única tabla plana de turnos sueltos (`Shift`) con filtros simples por `Sede`, `Empleado` y `Día` (este último deshabilitado si no se elige sede).
  - No tiene estructura de carpetas por sede ni por puesto, no muestra los puestos dentro de `/turnos`, no permite asignar días de la semana + horario fijo (`ShiftTemplate`), no muestra ni ordena por DNI (`nationalId`), y en `frontend/features/organization/mock.ts` todos los empleados tienen `nationalId: null`.
- **Backend (`backend/core/src/organization/`):**
  - `Site` y `Post` ya existen (`sites.controller.ts`, `posts.service.ts`).
  - `Shift` ya tiene `siteId`, `postId`, `employeeId`, `startsAt`, `endsAt`, `templateId` (nullable).
  - **Brecha B1 (`ShiftTemplate` pendiente):** Como indican `backend/core/src/organization/AGENTS.md` (§ Current Status) y `schema.prisma` (línea 3), **el módulo de plantillas semanales (`ShiftTemplate` + generador de 14 días) todavía NO está implementado**. Hoy solo pueden crearse turnos individuales por fecha/hora exacta.
  - **Brecha B2 (Búsqueda por DNI en `employees.service.ts`):** `ListEmployeesQueryDto.search` hoy busca únicamente en `firstName`, `lastName` y `email` (no en `nationalId`). Además, `canSeeNationalId` en `employee-policy.ts` oculta `nationalId` para `supervisor` (solo visible para `owner`, `admin` y el propio empleado).
  - **Brecha B3 (Horas extras por puesto/turno):** En paralelo con `PATH_fichado_salida_y_horas_extras.md`, se necesita poder asignar horas extras a un trabajador en un turno específico del puesto desde esta misma vista.

---

## 2. Diseño Funcional y de Navegación

### 2.1 Estructura de Carpetas en 3 Niveles (Rutas App Router)

Se adopta navegación mediante rutas anidadas bajo `/turnos` (mismo patrón que `/sedes` -> `/sedes/[siteId]`), lo que habilita navegación nativa atrás/adelante del navegador, enlaces compartibles y breadcrumbs claros:

| Nivel | Ruta sugerida | Contenido | Buscador Superior (Filtros Activos) |
|---|---|---|---|
| **Nivel 0 (Raíz)** | `/turnos` | Grid de **carpetas de Sedes** de la cuenta (ej. *Parripollo 1*). Si el usuario filtra por Puesto, Empleado o DNI desde la raíz, se muestran las sedes coincidentes y un bloque opcional de accesos directos al puesto/trabajador encontrado. | `Sede` · `Puesto de Trabajo` · `Empleado` · `DNI` |
| **Nivel 1 (Sede)** | `/turnos/[siteId]` | Breadcrumb `Turnos > <Nombre Sede>`. Grid de **carpetas de Puestos de Trabajo** (`Post`) creados para esa sede en *Sedes y Geocercas*. | `Puesto de Trabajo` · `Empleado` · `DNI` |
| **Nivel 2 (Puesto)** | `/turnos/[siteId]/[postId]` | Breadcrumb `Turnos > <Nombre Sede> > <Nombre Puesto>`. Botón para **asignar trabajador con horario y días de la semana**, lista ordenable de trabajadores asignados al puesto y sección/detalle de turnos generados (con asignación de horas extras). | `Nombre de Empleado` · `DNI` |

### 2.2 Lista Ordenable en Nivel 2 (Dentro de un Puesto)

La tabla (`DataTable`) dentro de `/turnos/[siteId]/[postId]` muestra cada asignación semanal (`ShiftTemplate`) del trabajador en ese puesto:
- **Columnas:**
  1. **Empleado** (Nombre y Apellido, avatar, estado activo/inactivo) — cabecera interactiva ordenable **`Nombre ↑ / ↓`** (`A–Z` / `Z–A`).
  2. **DNI** (`nationalId`, con legajo `employeeNumber` como dato secundario) — cabecera interactiva ordenable **`DNI ↑ / ↓`** (orden numérico/natural ascendente o descendente, dejando valores vacíos/ocultos al final).
  3. **Días de trabajo** (chips visuales `Lun`, `Mar`, `Mié`, `Jue`, `Vie`, `Sáb`, `Dom`).
  4. **Horario** (ej. `08:00 – 16:00` en la timezone de la sede).
  5. **Estado / Próximos turnos** (badge `Activa` / `Inactiva`, cantidad de turnos en los próximos 14 días, y badge de horas extra si tiene en el turno actual).
  6. **Acciones:** Editar horario/días, Desactivar/Reactivar asignación semanal, Ver/Gestionar turnos puntuales de la semana (incluyendo **Asignar horas extras** en un turno específico del puesto).

---

## 3. Fases y Pasos de Implementación

### Fase 0 — Contratos y Decisiones Previas
Commits: (solo lectura / decisiones)

- [ ] **TUR-0.1** Confirmar reglas pendientes en `backend/core/src/organization/AGENTS.md` y `frontend`:
  - **Visibilidad de DNI (`nationalId`) para `supervisor`:** actualmente `canSeeNationalId` en `backend/core/src/organization/employees/employee-policy.ts` oculta `nationalId` a `supervisor`. `DEFAULT`: mantener `nationalId` visible para `owner` y `admin` (si entra un `supervisor`, mostrar `—` en DNI y ocultar/deshabilitar filtro por DNI salvo confirmación explícita del usuario para habilitarlo en sus `siteIds`).
  - **Alcance de la asignación semanal (`ShiftTemplate`):** al crear o editar una asignación semanal (`weekdays` + `startTime` + `durationMinutes`), generar inmediatamente los turnos (`Shift`) para los próximos `SHIFT_HORIZON_DAYS` (14 días) además de la ejecución diaria del cron, para que el trabajador aparezca en asistencia/telemetría desde el primer minuto.
  - Check: Decisión registrada en `Decisions` de este archivo.

---

### Fase 1 — Backend `core/organization`: Modelo y Módulo `ShiftTemplate` + Búsqueda DNI
Commits: —

- [ ] **TUR-1.1** Actualizar `backend/core/src/organization/prisma/schema.prisma` (`teamworkflow-prisma-migrations`):
  - Agregar modelo `ShiftTemplate` según `backend/core/src/organization/AGENTS.md` § Data Model:
    - `id String @id @default(uuid(7)) @db.Uuid`
    - `tenantId String @map("tenant_id") @db.Uuid`
    - `siteId String @map("site_id") @db.Uuid`
    - `postId String @map("post_id") @db.Uuid`
    - `weekdays Int[]` (`1 = lunes ... 7 = domingo`)
    - `startTime String @map("start_time")` (`HH:mm` en timezone de la sede)
    - `durationMinutes Int @map("duration_minutes")`
    - `employeeId String? @map("employee_id") @db.Uuid`
    - `isActive Boolean @default(true) @map("is_active")`
    - `createdAt`, `updatedAt`
    - Relaciones hacia `Site`, `Post`, `Employee` (y agregar relación `template ShiftTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)` en `Shift`, aprovechando la columna `template_id` ya existente!).
    - Índices: `@@index([tenantId, siteId, postId, isActive])`, `@@index([tenantId, employeeId])`.
  - Crear y revisar migración `create_shift_templates` (agregar `CHECK (duration_minutes > 0 AND duration_minutes <= 1440)` en SQL con `--create-only`).
  - Check: `pnpm exec prisma validate --config prisma.organization.config.ts`, `migrate:status` y `prisma:organization:generate` pasan.
- [ ] **TUR-1.2** Implementar `ShiftTemplatesService`, DTOs y `ShiftTemplatesController` (`backend/core/src/organization/shifts/`):
  - DTOs en `dto/shift-template.dto.ts`:
    - `CreateShiftTemplateBodyDto`: `siteId` (UUID), `postId` (UUID), `weekdays` (array no vacío de ints únicos `1..7`), `startTime` (`^([01]\d|2[0-3]):[0-5]\d$`), `durationMinutes` (int `1..1440`), `employeeId` (UUID nullable).
    - `UpdateShiftTemplateBodyDto`: mismos campos editables opcionales + `isActive?: boolean`.
    - `ListShiftTemplatesQueryDto`: `siteId?`, `postId?`, `employeeId?`, `isActive?`, paginación (`page`, `pageSize`).
  - Reglas de negocio (`organization/AGENTS.md` § Shift templates and generation):
    - Roles de escritura: `owner` y `admin` (o `supervisor` en sus `siteIds`? Nota: `organization/AGENTS.md` línea 50 marca `Manage shift templates` solo `owner/admin`; respetar esa regla o documentar si `supervisor` también puede asignar en sus sedes).
    - Al crear/actualizar una plantilla con `employeeId`, validar que el empleado exista y esté activo en el tenant; generar los turnos faltantes de los próximos `SHIFT_HORIZON_DAYS` (14 días) en la timezone de la sede de forma idempotente usando el índice único `(tenantId, templateId, startsAt)`, omitiendo fechas donde haya solapamiento (`shift_overlap`) o reportando `warnings` (`rest_under_12h`, `weekly_hours_exceeded`, `missing_skill`, `site_not_enabled`).
    - Emitir `t.<tenant>.organization.shift_created` por cada turno generado (para que `telemetry` sincronice su `ShiftSnapshot`).
    - Exponer `POST /shift-templates`, `PATCH /shift-templates/:templateId`, `POST /shift-templates/:templateId/deactivate`, `GET /shift-templates` y métodos correspondientes en `OrganizationService` (fachada).
  - Check: `shift-templates.service.spec.ts` y `shift-templates.controller.spec.ts` prueban: creación + generación idempotente en timezone de sede (incluyendo turnos que cruzan medianoche), desactivación sin borrar historial, permisos por rol y aislamiento multi-tenant.
- [ ] **TUR-1.3** Implementar Job diario generador de turnos (`ShiftGeneratorJob`, `@Cron('0 2 * * *')`) en `backend/core/src/organization/shifts/shift-generator.job.ts`:
  - Recorre tenants activos (`!TenantState.isSuspended`) y sus `ShiftTemplate` activas generando los turnos del horizonte `SHIFT_HORIZON_DAYS` (default `14`, validado en `src/config/envs.ts` si aún no está).
  - Si el empleado de la plantilla quedó inactivo, genera turnos sin asignar (`employeeId: null`), cumpliendo `organization/AGENTS.md` § Shift templates rule 4.
  - Check: `shift-generator.job.spec.ts` verifica idempotencia al correr dos veces seguidas, salto de tenants suspendidos y regla de empleado inactivo.
- [ ] **TUR-1.4** Ampliar búsqueda por DNI en `EmployeesService.list` (`backend/core/src/organization/employees/employees.service.ts`):
  - En `list()`, si `query.search` está presente:
    - Para `owner` / `admin` (roles que pueden ver `nationalId`), incluir `{ nationalId: contains }` además de `firstName`, `lastName`, `email` y `employeeNumber`.
    - Para `supervisor`, NO buscar ni exponer sobre `nationalId` (para evitar inferencia/filtración).
  - Check: `employees.service.spec.ts` verifica que `owner`/`admin` encuentra por DNI parcial o completo y `supervisor` no filtra ni recibe `nationalId`.

---

### Fase 2 — Capa de Datos Frontend (`frontend/features/organization/`)
Commits: —

- [ ] **TUR-2.1** Actualizar tipos y contratos en `frontend/features/organization/types.ts`:
  - Agregar `ShiftTemplate`, `CreateShiftTemplateInput`, `UpdateShiftTemplateInput`, `ListShiftTemplatesQuery`.
  - Agregar `authorizedOvertimeMinutes?: number` en `Shift` (alineado con `PATH_fichado_salida_y_horas_extras.md`).
  - Check: `pnpm exec tsc --noEmit` en `frontend/` pasa.
- [ ] **TUR-2.2** Actualizar `frontend/features/organization/api.ts`, `http.ts`, `mock.ts`, `labels.ts` y `frontend/shared/mocks/world.ts`:
  - Agregar operaciones `listShiftTemplates`, `createShiftTemplate`, `updateShiftTemplate`, `deactivateShiftTemplate` y `assignShiftOvertime`.
  - Agregar etiquetas de días de semana (`WEEKDAY_LABELS`: `1 -> 'Lun' ... 7 -> 'Dom'`).
  - Poblar `nationalId` de prueba (ej. `'34.120.450'`, `'38.901.234'`, ...) y plantillas semanales mock en `organization/mock.ts` para probar carpetas, filtros por DNI y ordenamiento en modo `NEXT_PUBLIC_USE_MOCKS=true`.
  - Check: `pnpm exec tsc --noEmit` pasa; en modo mock todas las sedes y puestos muestran datos consistentes.

---

### Fase 3 — UI Jerárquica en Carpetas + Buscador Progresivo + Lista Ordenable (`frontend/`)
Commits: —

- [ ] **TUR-3.1** Crear componentes reutilizables de la vista Turnos en `frontend/features/organization/components/`:
  - `ShiftFolderBreadcrumbs.tsx`: migas de pan (`Turnos` -> `<Sede>` -> `<Puesto>`) con soporte responsive (`390px`) y botones accesibles.
  - `ShiftSearchBar.tsx`: barra superior contextual (`Toolbar`) que recibe el nivel actual (`'root' | 'site' | 'post'`) y renderiza **únicamente los filtros permitidos para ese nivel**:
    - `'root'` (4 filtros): `Sede` (select/texto), `Puesto de Trabajo` (texto/select), `Empleado` (texto nombre/apellido) y `DNI` (texto documento).
    - `'site'` (3 filtros): `Puesto de Trabajo` (select/texto entre los puestos de esa sede), `Empleado` y `DNI`.
    - `'post'` (2 filtros): `Nombre de Empleado` y `DNI`.
  - `ShiftFolderGrid.tsx`: tarjetas con estética `Card` (`glow="bottom"`) e ícono de carpeta para Sedes (Nivel 0) y Puestos (Nivel 1), mostrando contadores reales (puestos activos, trabajadores asignados, turnos en curso).
  - `AssignWeeklyWorkerModal.tsx`: modal dentro del puesto para asignar/editar un trabajador con **días de la semana** (botones toggle `L M X J V S D`), **horario de entrada (`HH:mm`)**, **horario de salida (`HH:mm`)** (calcula `durationMinutes` manejando turnos nocturnos que cruzan medianoche) y advertencias no bloqueantes devueltas por el backend.
  - Check: `pnpm lint` y `tsc --noEmit` pasan; cero colores `#hex` hardcoded (solo tokens semánticos de `globals.css`).
- [ ] **TUR-3.2** Implementar los 3 niveles de vistas y rutas App Router:
  - **Nivel 0 (`frontend/app/(dashboard)/turnos/page.tsx` -> `ShiftsRootView.tsx`):**
    - Carga `sites`, `posts` (de las sedes accesibles), `employees` y `shiftTemplates` (y/o `shifts`).
    - Muestra una carpeta por cada Sede (ej. *Parripollo 1*) filtrada por los 4 campos del buscador superior. Si se busca por Puesto, Empleado o DNI desde Nivel 0, filtra las sedes con coincidencias y muestra además accesos rápidos al puesto/trabajador coincidente.
    - Al hacer click en una carpeta de Sede, navega a `/turnos/${site.id}` (conservando opcionalmente filtros compatibles en query params).
  - **Nivel 1 (`frontend/app/(dashboard)/turnos/[siteId]/page.tsx` -> `SitePostsFolderView.tsx`):**
    - Valida que la sede exista y esté en alcance (`404`/ErrorState si no).
    - Muestra breadcrumb `Turnos > <Sede>`, el buscador con los **3 filtros** (`Puesto de Trabajo`, `Empleado`, `DNI`) y las **carpetas de Puestos de Trabajo** creados en *Sedes y Geocercas* para esa sede.
    - Al hacer click en un Puesto, navega a `/turnos/${siteId}/${post.id}`.
  - **Nivel 2 (`frontend/app/(dashboard)/turnos/[siteId]/[postId]/page.tsx` -> `PostScheduleView.tsx`):**
    - Muestra breadcrumb `Turnos > <Sede> > <Puesto>`, botón `"Asignar trabajador"` (pre-fijado en esa sede y puesto) y buscador reducido a **2 filtros** (`Nombre de Empleado` y `DNI`).
    - Renderiza la lista (`DataTable` en desktop, accesible en móvil 390px) de trabajadores asignados al puesto con:
      - Ordenamiento interactivo en encabezados de columna por **Nombre** (`asc` / `desc`, usando `localeCompare(..., 'es', { sensitivity: 'base' })`) y por **DNI** (`asc` / `desc`, comparador numérico natural tratando `null` al final).
      - Chips de días de trabajo de la semana (`Lun..Dom`), horario (`HH:mm – HH:mm`), botones para editar/desactivar la asignación semanal, y sección/sub-vista de los **turnos puntuales del puesto** donde también se puede reasignar, cancelar o **asignar horas extra** al trabajador de un turno específico (conectado con `PATH_fichado_salida_y_horas_extras.md`).
  - Check: `pnpm lint`, `tsc --noEmit` y `pnpm build` en `frontend/` pasan sin errores.

---

### Fase 4 — Verificación E2E y Revisión Visual
Commits: —

- [ ] **TUR-4.1** Tests unitarios / E2E de flujo completo:
  - Backend: test de `ShiftTemplatesService` + `ShiftGeneratorJob` + búsqueda por DNI en `EmployeesService`.
  - Frontend (y verificación manual / Playwright si está configurado):
    1. En `/turnos`, verificar que aparecen las 4 opciones de filtro (Sede, Puesto, Empleado, DNI) y una carpeta por sede.
    2. Entrar a carpeta de sede (ej. *Parripollo 1*), verificar que desaparece el filtro Sede (quedan 3: Puesto, Empleado, DNI) y se listan los puestos creados en *Sedes y Geocercas*.
    3. Entrar a carpeta de puesto, verificar que quedan 2 filtros (Nombre de Empleado, DNI), asignar un trabajador con horario y días de la semana, ordenar la lista por Nombre (asc/desc) y por DNI (asc/desc), y verificar la respuesta en desktop (`1280px`) y mobile (`390px`).
  - Check: `pnpm lint`, `pnpm test` y `pnpm build` pasan en `backend/core/` y `frontend/`.

---

## Decisions & Defaults to Confirm

- **UBICACIÓN DE PLANIFICACIÓN:** Guardado en `frontend/MODIFICACION DE LA PESTANA DE TURNOS/` por ser la pestaña `/turnos` de `frontend/` el eje de la funcionalidad, manteniendo la simetría con `backend/core/IMPLEMENTACION DE ...` y `backend/telemetry/IMPLEMENTACION DE INFORMES/`.
- **DEFAULT(turnos-rutas):** Usar rutas anidadas `/turnos`, `/turnos/[siteId]` y `/turnos/[siteId]/[postId]` con `DataTable` y `Card` de `shared/components/`.
- **DEFAULT(turnos-dni-supervisor):** Mantener la política vigente de `backend/core/src/organization/employees/employee-policy.ts` (`nationalId` visible y filtrable/ordenable para `owner` y `admin`; oculto para `supervisor`). Confirmar si se requiere habilitar la lectura/ordenamiento por DNI también para `supervisor` en sus sedes asignadas.
- **DEFAULT(turnos-templates-role):** Mantener escritura de `ShiftTemplate` para `owner` y `admin` (según `organization/AGENTS.md` línea 50) o ampliar a `supervisor` dentro de sus `siteIds` si gestiona horarios semanales de su sede.
