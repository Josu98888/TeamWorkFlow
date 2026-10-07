# attendance — Fichadas, jornadas y alertas

`attendance` sabe **quién está presente en cada sede** y avisa cuando algo falla: registra las fichadas, calcula las horas trabajadas, detecta tardanzas y puestos sin cubrir, y alimenta en tiempo real la Torre de Control.

> **Estado:** todavía no existe la aplicación Nest; la carpeta solo contiene documentación. Este documento describe el diseño objetivo. Ver [Estado actual](#estado-actual).
>
> Documentos relacionados: [AGENTS.md](AGENTS.md) (reglas detalladas para agentes, fuente de verdad) · [README general](../../README.md) · [organization](../organization/README.md).

## En una mirada

| Tema | Decisión |
|------|----------|
| Forma | Una app NestJS 12 con cuatro módulos internos: `clock-ins`, `workdays`, `alerts`, `tower`. |
| Fichadas | `in`, `out`, `break_start`, `break_end`, por `gps`, `qr` o `manual` (manual lo crea un supervisor con motivo). |
| Ventana de entrada | Una entrada se acepta desde 60 min antes del inicio del turno hasta el fin del turno. Fuera de esa ventana: `no_matching_shift`, y un supervisor puede cargar una fichada manual. |
| Salida faltante | Si pasan 2 h desde el fin del turno sin salida, la jornada queda como `missing_clock_out` con 0 minutos computados y se alerta al supervisor, que carga una salida manual con motivo. Una salida del empleado que llega después (dentro de las 24 h offline) también se acepta: cierra la jornada y resuelve la alerta. |
| Ubicación | Dentro de la geocerca es válido; el QR de la sede es válido aunque falle el GPS; fuera de la geocerca sin QR **se acepta**, se marca `out_of_geofence` y se abre una alerta. Nunca se rechaza por ubicación. |
| Offline | La app envía un id único y la hora del dispositivo. Los duplicados se ignoran. Se acepta hasta 24 h de antigüedad (`clock_too_old` después). |
| Correcciones | Siempre con motivo, conservando el antes y el después. |
| Jornada | Por turno: minutos trabajados, horas extra y minutos de tardanza. Sin horas nocturnas ni feriados todavía. |
| Alertas | Tardanza (10 min), puesto sin cubrir (15 min), fuera de geocerca y salida faltante. Estados: abierta, reconocida, resuelta. |
| Torre de Control | Un evento de resumen por sede en cada cambio; el gateway lo reenvía por Socket.IO. |
| Plan | Fichadas y jornadas son del plan `basic`. **Alertas y Torre de Control son del plan `pro`**: el gateway bloquea esas rutas (403 `feature_not_in_plan`) con los datos de `auth.token.verify`, y este servicio guarda además una copia local de las funcionalidades del tenant (con `billing.subscription_created` y `billing.plan_changed`) para no detectar alertas ni emitir resúmenes en tenants `basic`. |
| Datos de turnos | Copia local alimentada por los eventos de `organization`, con consulta de respaldo. |
| Datos | PostgreSQL con Prisma 7 y su propio `schema.prisma`. |

## Qué hace y qué no

**Hace**

- Registra fichadas con control de geocerca y QR, incluidas las offline.
- Permite a supervisores corregir o crear fichadas manuales con auditoría.
- Calcula la jornada de cada turno.
- Detecta tardanzas, puestos sin cubrir, fichadas fuera de geocerca y salidas faltantes, y administra el ciclo de vida de las alertas.
- Publica los resúmenes por sede y responde la foto inicial de la Torre de Control.

**No hace**

| Qué | Dónde vive |
|-----|-----------|
| Sedes, empleados y turnos | `organization` |
| Envío de notificaciones (push, notificaciones en la app) | `notifications` |
| Conexión Socket.IO con el navegador | `gateway` |
| Selfie al fichar, GPS continuo, umbrales configurables, horas nocturnas, feriados, cierre de períodos | Trabajo futuro |

## Permisos

| Acción | owner / admin | supervisor | employee |
|--------|:-------------:|:----------:|:--------:|
| Fichar | ❌ | ❌ | ✅ (solo a sí mismo) |
| Crear o corregir fichadas (con motivo) | ✅ | ✅ solo sus sedes | ❌ |
| Reconocer y resolver alertas (plan `pro`) | ✅ | ✅ solo sus sedes | ❌ |
| Ver la Torre de Control (plan `pro`) | ✅ todas las sedes | ✅ solo sus sedes | ❌ |
| Ver fichadas y jornadas | ✅ todas | ✅ solo sus sedes | las propias |

El actor lo toma el gateway del resultado de `auth.token.verify`; nunca de headers ni del body.

## Flujos

### Fichada con control de ubicación

```mermaid
flowchart TD
  A[Llega la fichada] --> B{Duplicada o más de 24 h?}
  B -- duplicada --> C[Se devuelve la ya guardada]
  B -- más de 24 h --> D[Rechazada: clock_too_old]
  B -- no --> M{Turno que corresponde?}
  M -- ninguno --> N[Rechazada: no_matching_shift]
  M -- sí --> E{Método}
  E -- QR --> F{QR de la sede?}
  F -- sí --> G[Válida]
  F -- no --> H[Rechazada: invalid_qr]
  E -- GPS --> I{Dentro del radio?}
  I -- sí --> G
  I -- no --> J[Aceptada con out_of_geofence y alerta]
  G --> K[Recalcula la jornada y emite el resumen de la sede]
  J --> K
```

### Alertas

```mermaid
stateDiagram-v2
  [*] --> open: late / uncovered_post / out_of_geofence / missing_clock_out
  open --> acknowledged: supervisor reconoce
  open --> resolved: resolución manual o llegada de la fichada
  acknowledged --> resolved: resolución manual o llegada de la fichada
```

| Tipo | Se abre cuando | Se resuelve sola |
|------|----------------|------------------|
| `late` | El empleado asignado no fichó entrada 10 min después del inicio | Cuando llega su entrada |
| `uncovered_post` | Nadie fichó entrada 15 min después del inicio | Cuando llega cualquier entrada |
| `out_of_geofence` | Una fichada se aceptó fuera de la geocerca | No (la resuelve un supervisor) |
| `missing_clock_out` | Pasaron 2 h desde el fin del turno y hay entrada sin salida | Cuando llega una salida (manual de un supervisor, o la del empleado que llega tarde) |

Se evalúan con los eventos de turnos de `organization` y con una revisión periódica de los turnos en curso (y de los terminados cuya jornada sigue abierta). Los umbrales son fijos por ahora.

### Salida faltante

Si el empleado fichó la entrada y no la salida, hasta 2 h después del fin del turno la jornada sigue abierta. Pasado ese plazo queda marcada como `missing_clock_out`, con **0 minutos computados**, y se abre una alerta para los supervisores de la sede. El supervisor carga una salida manual con motivo (`attendance.clock-event.create-manual`): se recalculan los minutos reales, la jornada se cierra y la alerta se resuelve sola. Lo mismo ocurre si la salida del propio empleado llega después de marcada la jornada (por ejemplo, una fichada offline sincronizada tarde), siempre que respete la regla de 24 h y la ventana de turno.

### Torre de Control

```mermaid
sequenceDiagram
  participant App as App móvil
  participant G as gateway
  participant AT as attendance
  participant Web as Navegador
  App->>G: fichada
  G->>AT: attendance.clock-event.create
  AT--)G: t.{tenant}.attendance.site_summary_updated
  G--)Web: Socket.IO (sala de la sede)
  Web->>G: abre la Torre de Control
  G->>AT: attendance.tower.snapshot
  AT-->>G: estado inicial de las sedes del actor
```

El resumen contiene `expected` (esperados), `present` (presentes) y `openAlerts` (alertas abiertas). NATS nunca se expone al navegador.

### Datos de turnos

`attendance` mantiene una copia local de los turnos, actualizada con los eventos de `organization` (cada evento trae el turno completo). Si falta un turno, lo pide con `organization.shift.get`. La geocerca y el QR se consultan con `organization.site.get` y se guardan un tiempo corto en memoria.

### Funcionalidades del plan dentro del servicio

Los tenants `basic` no tienen alertas ni Torre de Control. Con la copia local de funcionalidades, sin `alerts` no se detectan alertas (ni la revisión periódica ni la de eventos) y sin `tower` no se emite `site_summary_updated`. Las fichadas y las jornadas siguen funcionando. Si el tenant baja de plan, las alertas existentes se conservan y no se abren nuevas. Sin copia todavía se asume que no hay funcionalidades `pro`.

### Suspensión y cancelación del tenant

Con `t.{tenant}.auth.tenant_suspended` o `tenant_cancelled` se pausa la revisión periódica de alertas para ese tenant; con `tenant_reactivated` se reanuda. Los datos se conservan.

### Borrado de datos del tenant

Con `t.{tenant}.billing.data_retention_expired` (90 días después de la cancelación) se borran de forma permanente e idempotente todos los datos del tenant en este servicio: turnos copiados, fichadas y correcciones, jornadas, alertas, estado y copia de funcionalidades.

## Contrato NATS

Los pedidos con respuesta usan `attendance.<recurso>.<accion>` y no llevan tenant en el subject. Los eventos usan `t.<tenant>.attendance.<evento>` (JetStream). El detalle de payloads está en [AGENTS.md](AGENTS.md#nats-contract).

**Request-reply**

| Subject | Quién lo llama | Para qué |
|---------|----------------|----------|
| `attendance.clock-event.create` | empleado | Fichar |
| `attendance.clock-event.create-manual` | supervisor / admin | Fichada manual con motivo |
| `attendance.clock-event.correct` | supervisor / admin | Corregir con motivo |
| `attendance.clock-event.list` | gateway | Listar fichadas |
| `attendance.workday.get` / `list` | gateway | Consultar jornadas |
| `attendance.alert.list` | gateway | Listar alertas |
| `attendance.alert.acknowledge` / `resolve` | supervisor / admin | Reconocer o resolver |
| `attendance.tower.snapshot` | supervisor / admin | Foto inicial de la Torre de Control |

**Eventos que publica:** `clock_event_recorded`, `clock_event_corrected`, `alert_opened`, `alert_acknowledged`, `alert_resolved`, `site_summary_updated`.

**Eventos que consume:** `organization.shift_created`, `shift_updated`, `shift_cancelled`, `shift_starting`, `shift_started`, `shift_ended`, `site_updated`, `auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated`, `billing.subscription_created` / `plan_changed` y `billing.data_retention_expired`. Todos los handlers son idempotentes.

**Errores** (el gateway los traduce a HTTP `{ detail, code }`)

| code | HTTP | Cuándo |
|------|------|--------|
| `forbidden` | 403 | El rol no permite la acción |
| `no_matching_shift` | 404 | No hay un turno que corresponda: una entrada fuera de la ventana (desde 60 min antes del inicio hasta el fin del turno), o una salida sin entrada abierta |
| `clock_too_old` | 422 | Fichada offline de más de 24 h |
| `invalid_qr` | 422 | El QR no corresponde a la sede |
| `alert_invalid_transition` | 409 | Transición de alerta inválida |
| `validation_error` | 422 | Datos de entrada inválidos |

## Modelo de datos

Modelos de Prisma: `ShiftSnapshot`, `ClockEvent`, `ClockEventCorrection`, `Workday`, `Alert`, `TenantState`, `TenantFeatures` y `ProcessedEvent`. Todos llevan `tenantId` y toda consulta lo filtra; hay tests que prueban el aislamiento entre tenants. El servicio tiene su propio `prisma/schema.prisma`; si comparte base con otros servicios se decide más adelante.

## Configuración

| Variable | Descripción |
|----------|-------------|
| `NATS_SERVER` | URLs de NATS separadas por coma |
| `DATABASE_URL` | Conexión a PostgreSQL |

Los umbrales (10 min, 15 min, 24 h, 60 min antes del turno para fichar la entrada y 2 h después del fin del turno para la salida faltante) son constantes en el código por ahora. El archivo `.env` nunca se commitea; las variables se documentan en `.env.example` (todavía no existe).

## Desarrollo

Todavía no hay aplicación que ejecutar. Cuando exista:

```bash
cd backend/attendance
pnpm install
pnpm start:dev

# Calidad
pnpm lint
pnpm test
pnpm build
```

## Estado actual

La carpeta contiene solo documentación (`AGENTS.md` y este `README.md`). Falta, entre otras cosas:

- [ ] Crear la app Nest como microservicio NATS (`NestFactory.createMicroservice`).
- [ ] Agregar `src/config/envs.ts` y `.env.example`.
- [ ] Instalar y configurar Prisma, `class-validator` y el scheduler de la revisión periódica.
- [ ] Implementar los módulos `clock-ins`, `workdays`, `alerts` y `tower`.
- [ ] Implementar los consumidores de eventos de `organization` y `auth`.
- [ ] Sumar el servicio a `backend/docker-compose.yml` y las rutas del gateway.
- [ ] Crear los tests unitarios y la carpeta `test/` para e2e.
