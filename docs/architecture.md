# Arquitectura del MVP: monolito modular + telemetría

> Registro de decisión (ADR). Estado: **aceptada** el 2026-10-24. Reemplaza la arquitectura de 7 microservicios del MVP (`gateway`, `auth`, `organization`, `attendance`, `tasks`, `notifications`, `billing`).

## Contexto

El MVP se diseñó como 7 microservicios comunicados por NATS. Hoy solo existen `backend/gateway` (guard de autenticación y controlador de auth) y `backend/auth` (implementado hasta S7); el resto está documentado pero no construido.

Operar 7 servicios antes de tener usuarios implica 7 despliegues, 7 pipelines, 7 configuraciones y depuración distribuida para cada flujo. El costo es alto y el beneficio (escalar o desplegar cada dominio por separado) todavía no se necesita, salvo en un caso: la ingesta de fichadas y la Torre de Control, que tienen carga de alta frecuencia y conexiones en tiempo real.

## Decisión

El backend del MVP son **2 servicios**:

| Servicio | Carpeta | Contiene | Expone |
|---|---|---|---|
| `core` (monolito modular) | `backend/core/` | Módulos `auth`, `organization`, `tasks`, `notifications`, `billing` y la API HTTP pública (el antiguo `gateway`) | HTTP `/api`; responde peticiones NATS de telemetría (`auth.token.verify`, `organization.*.get`) |
| `telemetry` | `backend/telemetry/` | Todo el dominio `attendance`: ingesta de fichadas, correcciones, jornadas (`Workday`), alertas en tiempo real y Torre de Control | HTTP `/api/telemetry`; WebSocket (Socket.IO) de la Torre de Control |

Ambos servicios se publican bajo el mismo origen mediante un proxy inverso que enruta por path, por lo que el frontend sigue viendo una sola API.

### Fronteras entre módulos del `core`

- Cada módulo es un `Module` de NestJS en `backend/core/src/<module>/` y expone hacia afuera solo un servicio público (fachada). Otro módulo nunca importa sus repositorios, su cliente de Prisma ni sus clases internas.
- Las reacciones entre dominios (por ejemplo, `billing.plan_changed` → `auth` actualiza el plan del tenant) se hacen **por eventos**, no por llamadas directas. Las llamadas síncronas a la fachada se reservan para lecturas necesarias dentro de una petición.
- Un módulo debe poder extraerse a su propio servicio sin cambiar sus consumidores de eventos.

### Bus de eventos

- **NATS JetStream es el único bus de eventos de dominio**, tanto entre módulos del `core` como entre `core` y `telemetry`.
- Se mantiene la convención existente: subjects `t.<tenant>.<module>.<event>`, un stream `<MODULE>_EVENTS` por módulo, consumidores durables con ack explícito y deduplicación con `ProcessedEvent` en la misma transacción que el handler.
- Las peticiones síncronas entre `telemetry` y `core` usan NATS request/reply con patrones `<module>.<resource>.<action>`.

### Base de datos

- Una base PostgreSQL `teamworkflow`. Cada módulo del `core` y `telemetry` conserva **su propio schema, su propio rol, su propio cliente de Prisma y sus propias migraciones** (`auth`, `organization`, `tasks`, `notifications`, `billing`, `attendance`).
- El aislamiento entre schemas sigue garantizado por los roles de PostgreSQL (backend/STEPS.md S2.2b), no solo por convención: el `core` abre una conexión por módulo con el rol de ese módulo.
- Sin claves foráneas entre schemas.

### Autenticación en `telemetry`

`telemetry` verifica el token de cada petición HTTP y de cada conexión WebSocket con la petición NATS `auth.token.verify`, que responde el módulo `auth` del `core`. El resultado incluye el tenant, el rol y los `siteIds` permitidos para unir el socket a las salas de cada sede.

### Eventos que cruzan la frontera

- `core` → `telemetry`: eventos de `organization` (turnos, sedes, empleados), `auth` (estado del tenant) y `billing` (plan, retención de datos), que alimentan las copias locales `ShiftSnapshot`, `TenantState` y `TenantFeatures`.
- `telemetry` → `core`: `clock_event_recorded`, `clock_event_corrected`, `workday_closed`, `alert_opened`, `alert_acknowledged`, `alert_resolved`, que consumen `notifications` y los futuros reportes.
- `site_summary_updated` lo consume solo `telemetry` para emitir a la Torre de Control.

## Consecuencias

**Positivas**

- 2 despliegues en lugar de 7; la depuración local de un flujo del `core` ocurre en un solo proceso.
- Menor costo de infraestructura: un contenedor de aplicación más NATS y PostgreSQL para todo lo que no es tiempo real.
- La carga de alta frecuencia y las conexiones WebSocket escalan por separado en `telemetry`, sin afectar la API.
- Se conserva el desacoplamiento: eventos entre dominios, datos aislados por rol y módulos extraíbles.

**Negativas / costos aceptados**

- NATS sigue siendo necesario incluso para levantar solo el `core` en local.
- Un fallo grave del proceso `core` afecta a todos sus módulos a la vez.
- El `core` mantiene varias conexiones a la base (una por módulo y rol).
- La disciplina de fronteras entre módulos depende de revisión de código y de la estructura de carpetas, no de la red.

## Migración

1. Actualizar la documentación (README, AGENTS, STEPS, `docs/database.md`, skills).
2. Crear `backend/core` a partir de `backend/gateway` y `backend/auth`: los controladores de auth pasan de `@MessagePattern` a HTTP; los servicios, DTOs, eventos y tests se mueven sin cambios de lógica.
3. Ajustar `docker-compose` para levantar `core`, NATS y PostgreSQL.
4. Construir `telemetry` cuando se planifique el dominio `attendance`.

La arquitectura objetivo de 16 servicios del [README](../README.md) sigue siendo la referencia a largo plazo: cada módulo del `core` es el candidato natural a extraer cuando la carga o el equipo lo justifiquen.
