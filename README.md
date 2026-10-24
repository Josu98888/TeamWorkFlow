# Plataforma SaaS de gestión de personal: arquitectura, microservicios y base de datos

6 oct 2026 · @josu

> Documentos relacionados: [AGENTS.md](AGENTS.md) (guía para agentes y convenciones del repositorio) · [docs/architecture.md](docs/architecture.md) (decisión de arquitectura del MVP: monolito modular + telemetría) · [docs/database.md](docs/database.md) (modelo de datos con diagramas) · [backend/core/AGENTS.md](backend/core/AGENTS.md) (reglas del servicio `core` y de sus módulos; fuente de verdad del módulo `auth`: [backend/core/src/auth/AGENTS.md](backend/core/src/auth/AGENTS.md)).

## Estado actual del repositorio

Hoy solo existen:

- `backend/gateway`: punto de entrada HTTP (guard de autenticación, filtro de excepciones y controlador de auth).
- `backend/auth`: servicio de autenticación con la mayor parte de la lógica descrita en la sección [auth](#2-auth) ya implementada.
- `frontend/`: esqueleto de Next.js.

El MVP se rediseñó como **2 servicios** (`core` y `telemetry`; ver [MVP](#mvp) y [docs/architecture.md](docs/architecture.md)). **Migración en curso:** `backend/core` todavía no existe; `backend/gateway` y `backend/auth` se fusionarán en él y pasarán a ser su capa HTTP y su módulo `auth`. `backend/telemetry` tampoco existe todavía. También hay documentación de diseño (sin código) de los módulos del MVP en `backend/organization`, `backend/attendance`, `backend/tasks`, `backend/notifications` y `backend/billing`; esa documentación se reorganizará en `backend/core` y `backend/telemetry`. Todo lo demás (esos módulos, las bases de datos, la Torre de Control, etc.) está **planificado**; consulte la sección [MVP](#mvp) y, más abajo, la arquitectura objetivo.

## Descripción de la aplicación

Una plataforma SaaS multitenant para gestionar y monitorear, en tiempo real, al personal operativo distribuido en muchas sedes. Reemplaza las planillas, los grupos de WhatsApp y las llamadas telefónicas por una única herramienta que conserva evidencia auditable.

### Qué hace

- Gestiona sedes, puestos, geocercas y turnos.
- Registra la asistencia con fichadas validadas por geocerca y calcula los minutos trabajados, de horas extra y de tardanza.
- Crea tareas y formularios dinámicos definidos como JSON, con fotos, códigos QR y listas de verificación.
- Monitorea todo desde una Torre de Control en tiempo real mediante WebSockets.
- Recibe alertas por llegadas tarde, puestos sin cubrir y problemas de cobertura.
- Asigna automáticamente turnos de emergencia entre los empleados disponibles (futuro).

### Usuarios y aplicaciones

| Usuario | Aplicación | Qué hace |
|---|---|---|
| Empleado operativo (`employee`) | App móvil (con modo sin conexión) | Ficha entrada y salida, ve sus turnos, completa tareas y formularios, acepta turnos de emergencia (futuro) |
| Supervisor (`supervisor`) | Web + app móvil | Observa la Torre de Control de las sedes que tiene asignadas, atiende alertas, corrige fichadas. No gestiona usuarios |
| Administrador del tenant (`admin`) | Web | Configura sedes, geocercas, turnos y formularios; gestiona supervisores y empleados (invitar, desactivar, restablecer acceso, asignar sedes) |
| Propietario del tenant (`owner`) | Web | Todo lo anterior, además de gestionar administradores y la facturación. Hay exactamente uno por tenant |
| Administrador de la plataforma (`platform_admin`) | Web (rutas de plataforma) | No pertenece a ningún tenant. En el MVP gestiona planes y precios, registra pagos manuales, anula facturas y extiende períodos de prueba; el backoffice completo (creación de tenants, soporte, métricas globales) es trabajo futuro |

Los roles dentro de un tenant son fijos: `owner`, `admin`, `supervisor` y `employee` (ver [auth](#2-auth)). Hoy un tenant se crea cuando alguien se registra; la creación de tenants por un superadministrador y su backoffice son trabajo futuro.

## Modelo de negocio

Clientes objetivo: seguridad privada, limpieza y gestión de instalaciones, comercio minorista, logística, mantenimiento y atención de salud a domicilio. La seguridad y la limpieza son el mejor nicho de entrada porque sus contratos incluyen SLA y penalidades de cobertura.

Monetización: suscripción mensual con un **precio fijo en pesos argentinos (ARS) por plan**, no por empleado ni por uso.

| Plan | Incluye | Precio |
|---|---|---|
| Basic (`basic`) | Sedes, empleados, turnos y asistencia | Precio mensual fijo en ARS |
| Pro (`pro`) | Basic + tareas y formularios, alertas y Torre de Control | Precio mensual fijo en ARS |
| Enterprise | Pro + asignación automática de emergencias, SSO (futuro), API e integraciones, aislamiento dedicado | Trabajo futuro |

- **Prueba gratuita:** cada tenant nuevo recibe 14 días del plan Pro. Esos días no se facturan.
- **Facturación:** mensual, por período vencido (el día 1 se factura el mes anterior, con el plan más alto que haya estado activo), con IVA del 21 % en una línea aparte y vencimiento 10 días después de la emisión. Los nuevos precios se aplican desde la factura siguiente.
- **Medios de pago:** Mercado Pago (un enlace de pago por factura) y transferencia bancaria registrada manualmente por la plataforma. La facturación fiscal electrónica (ARCA) queda fuera del MVP.
- **Mora:** si una factura sigue impaga después de su vencimiento, el tenant pasa a estado de mora, recibe avisos y se suspende el día 7 de atraso; un pago completo lo reactiva. La fecha de vencimiento es el último día para pagar.
- **Cancelación:** siempre se hace efectiva a fin de mes y puede deshacerse antes de esa fecha. Un tenant cancelado conserva el mismo acceso restringido que uno suspendido, puede volver a suscribirse eligiendo un plan (sin nueva prueba) y, pasados 90 días, sus datos se eliminan en todos los servicios, salvo facturas y pagos.
- **Ingresos adicionales (futuro):** SMS y WhatsApp por volumen, almacenamiento extra de fotos, conectores de liquidación de sueldos, implementación paga para clientes grandes y descuentos por pago anual.
- **Costos principales:** infraestructura en la nube (telemetría GPS, WebSockets y fotos), mensajería SMS y push, soporte y desarrollo.
- **Métricas clave:** MRR y ARR, tenants activos por plan, abandono (churn), relación CAC/LTV y el porcentaje de cobertura de puestos logrado para cada cliente.

## MVP

El MVP se construye con **2 servicios de backend** (los nombres de carpetas, los patrones de NATS y los eventos están en inglés), según el registro de decisión [docs/architecture.md](docs/architecture.md). Reemplaza el diseño anterior de 7 microservicios. La arquitectura objetivo de 16 servicios descrita más abajo sigue siendo la referencia a largo plazo.

| Servicio del MVP | Carpeta | Contiene | Expone |
|---|---|---|---|
| `core` (monolito modular) | `backend/core/` (por crear) | Módulos `auth`, `organization`, `tasks`, `notifications` y `billing`, y la API HTTP pública (el antiguo `gateway`) | HTTP `/api`; responde las peticiones NATS de telemetría (`auth.token.verify`, `organization.*.get`) |
| `telemetry` | `backend/telemetry/` (por crear) | Todo el dominio `attendance`: ingesta de fichadas, correcciones, jornadas, alertas en tiempo real y Torre de Control | HTTP `/api/v1/telemetry`; WebSocket (Socket.IO) de la Torre de Control |

Un proxy inverso publica ambos servicios bajo el mismo origen y enruta por path (`/api` hacia `core`; `/api/v1/telemetry` y `/ws` hacia `telemetry`), de modo que el frontend sigue viendo una sola API y nunca se conecta a NATS.

Qué grupo de la arquitectura objetivo implementa cada módulo del MVP:

| Módulo del MVP | Servicio | Documentación de diseño | Agrupa (arquitectura objetivo) |
|---|---|---|---|
| capa HTTP (antes `gateway`) | `core` | [backend/core/README.md](backend/core/README.md) | [gateway](#1-gateway) (sin el WebSocket de la Torre, que pasa a `telemetry`) |
| `auth` | `core` | [backend/core/src/auth/AGENTS.md](backend/core/src/auth/AGENTS.md) | [auth](#2-auth) |
| `organization` | `core` | [backend/core/src/organization/AGENTS.md](backend/core/src/organization/AGENTS.md) | [sites](#3-sites), [employees](#4-employees) y [shifts](#5-shifts) |
| `tasks` | `core` | [backend/core/src/tasks/AGENTS.md](backend/core/src/tasks/AGENTS.md) | [forms](#8-forms), [tasks](#9-tasks) y [media](#10-media) |
| `notifications` | `core` | [backend/core/src/notifications/AGENTS.md](backend/core/src/notifications/AGENTS.md) | [notifications](#13-notifications) (solo push e in-app) |
| `billing` | `core` | [backend/core/src/billing/AGENTS.md](backend/core/src/billing/AGENTS.md) | [billing](#16-billing) |
| `attendance` | `telemetry` | [backend/telemetry/README.md](backend/telemetry/README.md) | [attendance](#6-attendance), la parte de alertas de [rules](#11-rules) y [tower](#14-tower) |

La documentación de diseño de cada módulo vive junto a su código: `backend/core/src/<módulo>/AGENTS.md`; la de `telemetry` en `backend/telemetry/`.

Decisiones comunes del MVP:

- NestJS 12 sobre NATS, Prisma 7 con PostgreSQL (una sola base `teamworkflow`, con un schema, un usuario de Postgres, un cliente de Prisma y migraciones propias por módulo de `core` y para `telemetry`), `class-validator` y Jest.
- NATS JetStream es el único bus de eventos de dominio, tanto entre módulos de `core` como entre `core` y `telemetry`. Un stream `<MODULE>_EVENTS` por módulo, consumidores durables y deduplicación con `ProcessedEvent`.
- Fronteras entre módulos de `core`: un módulo solo expone un servicio público (fachada); nunca usa el cliente de Prisma ni las clases internas de otro módulo. Las reacciones entre dominios se hacen por eventos. Un módulo debe poder extraerse a su propio servicio sin cambiar a sus consumidores de eventos.
- Los patrones de solicitud-respuesta siguen `<module>.<resource>.<action>` (por ejemplo `billing.invoice.list`); el actor siempre proviene de `auth.token.verify`, nunca de los headers. Los eventos siguen `t.<tenant>.<module>.<event>` en `snake_case` (por ejemplo `t.<tenant>.organization.shift_started`), llevan `eventId` y `occurredAt`, se emiten después del commit y se consumen de forma idempotente.
- Sin buckets KV para datos de dominio, sin outbox obligatorio y sin Row Level Security obligatorio; toda consulta filtra por `tenantId`.
- Sin correos ni SMS: los avisos salen a través de `notifications` (push e in-app).
- Planes: `auth` guarda el plan y las funcionalidades del tenant (a partir de los eventos de `billing`) y la capa HTTP de `core` bloquea con 403 `feature_not_in_plan` las rutas que el plan no incluye. Las alertas, la Torre de Control, las tareas y los formularios son funcionalidades Pro.
- Rol `platform_admin`: no pertenece a ningún tenant, se crea mediante seed o CLI y solo opera las rutas de plataforma de `billing` (planes y precios, pagos manuales, anulaciones).

El diseño de cada módulo y su contrato (operaciones y eventos) están en el `AGENTS.md` de su carpeta (`backend/core/src/<módulo>/AGENTS.md` y `backend/telemetry/AGENTS.md`); el resumen de `core` está en [backend/core/README.md](backend/core/README.md).

## Arquitectura general

> Las secciones siguientes describen la **arquitectura objetivo** de 16 servicios (con nombres en inglés). El MVP la implementa agrupada en los 2 servicios anteriores (`core` y `telemetry`). Cada servicio indica a continuación dónde vive en el MVP.

En la arquitectura objetivo todos los microservicios se comunican por NATS; en el MVP, los módulos de `core` se comunican por eventos de JetStream (y por fachadas para lecturas dentro de una petición) y `telemetry` se comunica con `core` por NATS. HTTP solo existe en el borde: la app, la web y servicios externos como pagos y envío de push.

La app y la web ingresan por la API HTTP pública (`core` en `/api`, `telemetry` en `/api/v1/telemetry`, detrás de un proxy inverso). NATS nunca se expone a internet. La Torre de Control no se conecta a NATS desde el navegador: abre un WebSocket (Socket.IO) hacia `telemetry`, que valida el token con `auth.token.verify` (respondido por `core`), se suscribe del lado del servidor a los eventos de las sedes permitidas y reenvía los mensajes (ver [tower](#14-tower) y [Inicio de sesión y acceso](#inicio-de-sesión-y-acceso)).

Compensación de este diseño: `telemetry` mantiene conexiones WebSocket abiertas, pero separadas de la API de `core`. Si eso se convierte en un problema de carga, la conexión puede pasar a un servicio `tower` dedicado sin cambiar el frontend. Si algún día muchos clientes necesitaran conectarse directamente a NATS, un auth callout de NATS es una opción; hoy no se usa.

### Convención de subjects

| Tipo | Formato | Ejemplo | Transporte |
|---|---|---|---|
| Evento de dominio | `t.<tenant>.<service>.<event>` | `t.acme.attendance.clock_event_recorded` | JetStream |
| Consulta o comando | `<service>.<resource>.<action>` (sin prefijo de tenant) | `auth.token.verify`, `organization.site.get` | NATS Core, solicitud-respuesta |
| Solicitud de envío | `t.<tenant>.notifications.send` | `t.acme.notifications.send` | JetStream |
| Resumen de sede para la Torre (MVP) | `t.<tenant>.attendance.site_summary_updated` | `t.acme.attendance.site_summary_updated` | JetStream |
| Telemetría GPS (futuro) | `t.<tenant>.location.point.<employee>` | `t.acme.location.point.e123` | NATS Core |
| Resumen de la Torre (futuro, servicio dedicado) | `t.<tenant>.tower.summary.<site>` | `t.acme.tower.summary.site42` | NATS Core |

Las consultas y los comandos no llevan tenant en el subject: el tenant proviene del actor verificado y viaja en el payload (o en el header `Tenant-Id`) que arma la capa HTTP de `core` (o `telemetry`). Los eventos siempre llevan el tenant en el subject y, en el payload, `tenantId`, `eventId` y `occurredAt`; el consumidor verifica que ambos tenants coincidan. Todos los servicios siguen esta convención (por ejemplo `t.acme.auth.user_created`, `t.acme.billing.payment_received`).

### JetStream y KV

- **Streams:** uno por servicio publicador (por ejemplo `ATTENDANCE_EVENTS` con los subjects `t.*.attendance.>`), con 7 días de retención y 3 réplicas.
- **Consumers:** cada servicio que escucha crea su consumer durable con ack explícito, `MaxDeliver` de 5 y backoff. Los mensajes que agotan sus reintentos van a un stream DLQ para su revisión.
- **Buckets KV (solo arquitectura objetivo, ninguno en el MVP):** `current_location`, `shifts_awaiting_clock_in`, `active_emergencies` y `tenant_config`.

### Multitenencia y datos

- El `tenantId` viaja en el JWT (verificado por `auth`), en el subject de cada evento, en el payload (o el header `Tenant-Id`) de cada consulta de solicitud-respuesta y en cada fila de la base de datos.
- Cada microservicio decide más adelante si comparte una base de datos PostgreSQL con otros servicios (con su propio schema) o tiene la suya. Row Level Security es opcional y solo se aplica cuando varios servicios comparten la misma base de datos.
- Cada servicio solo escribe y lee sus propias tablas. Nadie lee el schema de otro servicio: los datos ajenos se solicitan por NATS.
- Los clientes Enterprise pueden tener su propia cuenta de NATS y, como complemento, una base de datos dedicada.

## Detalle de cada microservicio

Hay 18 servicios: 16 de dominio y 2 transversales. Cada uno es dueño de sus datos y se comunica solo por NATS: los eventos pasan por JetStream con el prefijo `t.<tenant>.` y las consultas sincrónicas usan solicitud-respuesta con subjects `<service>.<resource>.<action>` (sin prefijo de tenant). En las consultas el tenant proviene del actor verificado: la capa HTTP lo toma de `auth.token.verify`, nunca del cliente.

### 1. gateway

- **MVP:** la capa HTTP de `core` (hoy el código existe en `backend/gateway` y se fusionará en `backend/core`; no hay un servicio gateway separado). El WebSocket de la Torre de Control lo atiende `telemetry`.
- **Rol:** el único punto de entrada HTTP y WebSocket para la app móvil y la web.
- **Qué hace:** verifica el token de acceso llamando a `auth.token.verify` por NATS, toma `tenantId`, `role` y `siteIds` del resultado verificado (nunca del body, el query ni los headers), aplica rate limiting y traduce cada solicitud HTTP a un mensaje NATS.
- **API:** una única API REST bajo `/api/v1/...` para web y móvil; los endpoints específicos para móvil se agregan solo cuando hacen falta.
- **Tokens:** en la web, los tokens de acceso y de refresco viajan en cookies `httpOnly`, `Secure` y `SameSite` con protección CSRF; la app móvil envía `Authorization: Bearer` y guarda el token de refresco en el almacenamiento seguro del dispositivo.
- **Rate limiting:** `@nestjs/throttler` en memoria: las rutas públicas (login, registro, aceptar invitación, restablecer contraseña, webhooks) se limitan por IP; las rutas autenticadas se limitan por usuario. Pasa a un almacén compartido (Redis) cuando el gateway corre con más de una réplica.
- **Restricción por plan:** toma `plan` y `features` del resultado verificado y responde 403 `feature_not_in_plan` en las rutas cuya funcionalidad el plan no incluye. Enruta `billing.admin.*` solo a `platform_admin`.
- **Tenant en mora, suspendido o cancelado:** lee `tenantStatus` del resultado de `auth.token.verify`. Si el tenant está `suspended` o `cancelled`, solo deja pasar al `owner` y a los `admin` hacia las rutas de facturación (pagar o volver a suscribirse) y de exportación de datos; todo lo demás responde 403 `tenant_suspended` o `tenant_cancelled`.
- **WebSocket de la Torre de Control:** con `@nestjs/websockets` (Socket.IO), el navegador se conecta a `telemetry` (ruta `/ws` del mismo origen) enviando el token de acceso. `telemetry` lo valida con `auth.token.verify`, une el socket a una sala por cada sede permitida (supervisor: sus `siteIds`; `owner`/`admin`: todas las sedes del tenant), se suscribe del lado del servidor a `t.<tenant>.attendance.site_summary_updated` y reenvía cada mensaje a la sala de su `siteId`. El estado inicial se solicita por solicitud-respuesta con `attendance.tower.snapshot`. Esto significa que `telemetry` mantiene conexiones WebSocket abiertas; más adelante puede pasar a un servicio `tower` dedicado sin cambiar el frontend. (Diseño objetivo: en el MVP el gateway es la capa HTTP de `core`.)
- **Webhooks:** expone la ruta pública del webhook de Mercado Pago y reenvía el cuerpo sin procesar a `billing.webhook.mercadopago`.
- **BFF (futuro):** APIs separadas para móvil y web solo si una única API compartida deja de ser suficiente.
- **Sin base de datos propia y sin NATS KV** (la capa HTTP de `core` no tiene schema; usa los módulos).

La revocación de sesiones vive en `auth` (tokens de refresco revocados en su base de datos) y `auth.token.verify` comprueba en cada solicitud que el usuario siga activo y que el estado del tenant permita el acceso; por eso no existe una lista de tokens revocados en NATS KV.

### 2. auth

- **MVP:** módulo `auth` de `core` (hoy `backend/auth`, que se fusionará en `backend/core`).

> Fuente de verdad: [`backend/core/src/auth/AGENTS.md`](backend/core/src/auth/AGENTS.md). El diseño original (DNI + PIN, MFA, SSO, auth callout, RBAC detallado) se simplificó; lo que se quitó figura más abajo como trabajo futuro.

- **Rol:** identidad, sesiones, alcance de sedes de los supervisores y estado de acceso del tenant.
- **Registro:** `auth.register` crea el tenant y su primer usuario, que pasa a ser el `owner`, en una única transacción, y emite `tenant_created` (consumido por `billing`, que inicia la prueba). El correo es único en todo el sistema.
- **Login:** correo y contraseña (hash Argon2id), con el mismo flujo para todos los roles, empleados incluidos. Tras 5 intentos fallidos consecutivos la cuenta se bloquea durante 15 minutos. Los errores de login siempre son genéricos (`invalid_credentials`); las únicas excepciones son `tenant_suspended` y `tenant_cancelled`, que se devuelven solo después de una contraseña correcta.
- **Roles fijos por tenant:** `owner`, `admin`, `supervisor` y `employee` (no configurables). Un tenant siempre tiene exactamente un `owner`; nadie puede desactivar ni degradar al `owner`. El `admin` gestiona supervisores y empleados (invitar, desactivar, restablecer acceso, cambiar el rol entre `supervisor` y `employee`, asignar sedes a supervisores); solo el `owner` gestiona administradores. `supervisor` y `employee` no gestionan usuarios. El rol de plataforma `platform_admin` no pertenece a ningún tenant y se crea únicamente mediante seed o CLI.
- **Alcance de sedes:** la columna `User.siteIds` (ids de sedes de `organization`, solo para supervisores) guarda las sedes de cada supervisor y se edita con `auth.user.assign-sites` (`owner`/`admin`). `auth.token.verify` devuelve `siteIds` solo para supervisores; los ids de sedes no van en el JWT.
- **Invitaciones:** `owner` y `admin` invitan a supervisores y empleados (solo el `owner` invita a administradores) con un enlace de un solo uso que vence en 7 días. El frontend muestra el enlace para copiarlo en el momento de la creación. Como los tokens se guardan solo con hash, `auth.invitation.list` lista las pendientes sin el enlace, y `auth.invitation.regenerate` emite un enlace nuevo (revocando el anterior) cuando el administrador lo necesita, por ejemplo para invitaciones creadas automáticamente desde `organization`. No se envían correos.
- **Alta de empleados:** el administrador crea el registro del empleado en `organization` con su correo; `organization` emite `t.<tenant>.organization.employee_created` y `auth` lo consume (de forma idempotente) y crea una invitación con el rol `employee`. El administrador copia el enlace desde la interfaz.
- **Tokens:** un token de acceso JWT de 15 minutos (claims `sub`, `tenantId`, `role`, `jti`, `iat`, `exp`, sin datos personales ni ids de sedes) y un token de refresco opaco, rotativo y revocable de 7 días (solo se guarda su hash SHA-256). La revocación vive en `auth`.
- **Verificación:** la capa HTTP de `core` y `telemetry` validan cada solicitud con `auth.token.verify`, que comprueba la firma, el vencimiento, que el usuario siga activo y que el estado del tenant permita el acceso. Devuelve `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }` (`plan` y `features` los mantiene `auth` a partir de los eventos de `billing`). Así, desactivar a un usuario o suspender un tenant surte efecto de inmediato.
- **Estado del tenant:** `active`, `past_due`, `suspended`, `cancelled` o `deleted` (con `pastDueSince`, `suspendedAt` y `cancelledAt`). `auth` es dueño del estado; `billing` es dueño de los pagos (ver [billing](#16-billing) y [Mora, suspensión y cancelación de un tenant](#mora-suspensión-y-cancelación-de-un-tenant)).
- **Restablecimiento de contraseña:** un `owner` o `admin` genera un enlace de un solo uso (1 hora) para otro usuario, según la tabla de roles. No existe un "olvidé mi contraseña" por correo.
- **Desactivación:** los usuarios nunca se eliminan; se desactivan, se revocan sus tokens de refresco y se emite `t.<tenant>.auth.user_deactivated`. La única eliminación definitiva es la purga de datos del tenant al vencer la retención.
- **Perfil de usuario:** vive en `organization` (módulo employees); no existe un servicio `users`. `auth` solo recibe el nombre en el registro o al aceptar la invitación y lo reenvía en el evento `t.<tenant>.auth.user_created`.
- **Patrones de solicitud-respuesta:** `auth.register`, `auth.login`, `auth.token.refresh`, `auth.logout`, `auth.token.verify`, `auth.invitation.create`, `auth.invitation.list`, `auth.invitation.regenerate`, `auth.invitation.accept`, `auth.user.change-role`, `auth.user.assign-sites`, `auth.user.deactivate`, `auth.user.list-recipients` (solo servicios internos, por ejemplo `notifications` y `billing`), `auth.password-reset.create`, `auth.password-reset.confirm`.
- **Publica:** `t.<tenant>.auth.user_created`, `user_role_changed`, `user_deactivated`, `tenant_created`, `tenant_past_due`, `tenant_suspended`, `tenant_cancelled` y `tenant_reactivated`.
- **Consume:** `t.<tenant>.organization.employee_created` y, de `billing`, `subscription_created`, `plan_changed`, `payment_overdue`, `subscription_expired`, `payment_received`, `subscription_cancelled`, `subscription_reactivated` y `data_retention_expired` (purga de los datos de identidad del tenant).

Fuera del alcance por ahora (**trabajo futuro**):

- MFA (TOTP) para administradores.
- Login con DNI + PIN o QR de sede para empleados operativos.
- Vinculación de dispositivo (un teléfono registrado por persona).
- SSO (OIDC y SAML) para clientes Enterprise.
- Auth callout de NATS: solo como opción futura si muchos clientes necesitaran conectarse directamente a NATS.
- Backoffice y creación de tenants por parte de la plataforma (el `platform_admin` del MVP solo opera `billing`), y roles y permisos configurables (RBAC detallado).
- Envío de correos y recuperación de contraseña por correo.
- Evaluar un proveedor de identidad externo si el alcance crece.

### 3. sites

- **MVP:** módulo `organization` de `core` (submódulo `sites`).
- **Rol:** sedes, puestos dentro de cada sede y geocercas.
- **Qué hace:** guarda la ubicación de cada sede, una geocerca como un punto más un radio en metros (los polígonos y PostGIS son trabajo futuro), su zona horaria, un código QR fijo por sede (rotable por un administrador) y los puestos (nombre, habilidades requeridas, mínimo de personas). Las sedes se desactivan, nunca se eliminan.
- **Solicitud-respuesta:** `organization.site.create` / `update` / `get` / `list` / `rotate-qr` y `organization.post.create` / `update` / `list`. La verificación de geocerca la calcula `attendance` (haversine) a partir de los datos de `organization.site.get`.
- **Publica:** `t.<tenant>.organization.site_updated` (ubicación, radio y si se rotó el QR).

### 4. employees

- **MVP:** módulo `organization` de `core` (submódulo `employees`).
- **Rol:** perfil de cada persona del tenant y registro operativo de los empleados.
- **Perfil:** cada usuario de `auth` tiene aquí un perfil (nombre, apellido, correo, teléfono, id de media del avatar). Los owners, admins y supervisores no necesitan número de legajo ni DNI; los empleados operativos sí.
- **Qué hace:** datos personales, habilidades, sedes habilitadas y un límite de horas semanales. Los empleados nunca se eliminan definitivamente.
- **Futuro:** disponibilidad declarada, certificaciones con vencimiento y la alerta por vencimiento de una certificación obligatoria (por ejemplo, la licencia de un vigilador).
- **Solicitud-respuesta:** `organization.employee.create` / `update` / `get` / `list` y `organization.employee.list-available` (empleados que pueden reemplazar en un turno, primero los de menos horas semanales).
- **Alta de acceso:** el registro se crea con el correo del empleado; `auth` consume `t.<tenant>.organization.employee_created` para generar la invitación con el rol `employee`.
- **Consume:** `t.<tenant>.auth.user_created` (si ya existe un perfil con ese correo, vincula su `userId`; de lo contrario crea el perfil sin número de legajo, como para el owner o un admin invitado), `t.<tenant>.auth.user_deactivated` (marca el perfil como inactivo y desasigna sus turnos futuros). Ambos handlers son idempotentes.
- **Publica:** `employee_created` (MVP). Otros eventos de la arquitectura objetivo, como `employee_updated`, `availability_changed` y `certification_expiring`, son futuros.

### 5. shifts

- **MVP:** módulo `organization` de `core` (submódulo `shifts`).
- **Rol:** planificación de qué puesto debe cubrirse, cuándo y por quién.
- **Qué hace:** plantillas semanales con un generador diario para los próximos 14 días, creación manual, edición, cancelación y reasignación con bloqueo optimista (`version`), y validación: una superposición bloquea (`shift_overlap`), mientras que un descanso menor a 12 horas, las horas semanales por encima del límite, la falta de una habilidad y una sede no habilitada solo generan advertencias. Los intercambios de turnos entre empleados con aprobación y la publicación de la grilla son trabajo futuro.
- **Job de ciclo de vida:** se ejecuta cada minuto, emite `shift_starting` 15 minutos antes del inicio, `shift_started` en el momento exacto y `shift_ended` al finalizar. Los tenants suspendidos y cancelados se omiten.
- **Solicitud-respuesta:** `organization.shift-template.create` / `update` / `deactivate` / `list` y `organization.shift.create` / `update` / `reassign` / `cancel` / `get` / `list`.
- **Publica:** `t.<tenant>.organization.shift_created`, `shift_updated` (edición, reasignación o desasignación), `shift_cancelled`, `shift_starting`, `shift_started` y `shift_ended`, todos con una instantánea completa del turno.
- **Consume (futuro):** `t.<tenant>.emergencies.emergency_accepted` (reasigna el turno). Hoy una persona reasigna los turnos manualmente.

### 6. attendance

- **MVP:** servicio `telemetry` (dominio `attendance`, submódulos `clock-ins` y `workdays`).
- **Rol:** fichadas y horas trabajadas.
- **Qué hace:** registra `in`, `out`, `break_start` y `break_end` por `gps`, `qr` o `manual`; asocia cada evento al turno del empleado; verifica la geocerca con los datos de `organization.site.get` y nunca rechaza por ubicación (fuera de la geocerca el evento se acepta, se marca y se abre una alerta); permite correcciones con un motivo obligatorio y una fila de auditoría (`ClockEventCorrection`).
- **Sin conexión:** acepta fichadas tardías con la hora real del dispositivo (`deviceTime`, dentro de las 24 horas) y las deduplica por `clientEventId`.
- **Horas:** una jornada por turno con minutos trabajados, de horas extra y de tardanza. Las horas nocturnas y los feriados son trabajo futuro.
- **Solicitud-respuesta:** `attendance.clock-event.create` / `create-manual` / `correct` / `list` y `attendance.workday.get` / `list`.
- **Publica:** `t.<tenant>.attendance.clock_event_recorded` y `clock_event_corrected`.
- **Consume:** los eventos de turnos de `organization` (`shift_created`, `shift_updated`, `shift_cancelled`, `shift_starting`, `shift_started`, `shift_ended`) para mantener una copia local de los turnos, y los eventos de estado del tenant de `auth` y los eventos de plan de `billing`.

### 7. location

- **MVP:** ninguno. Es un servicio **futuro**.
- **Rol:** telemetría GPS durante el turno.
- **Qué hará:** recibirá puntos por NATS Core cada 30 a 60 segundos, mantendrá la última posición en NATS KV y el historial en TimescaleDB con retención según el plan.
- **Detección:** comparará contra la geocerca y publicará las entradas y salidas.
- **Publica (futuro):** `t.<tenant>.location.geofence_exited`, `geofence_entered` y `signal_lost` (sin puntos durante 10 minutos).

Hoy attendance solo verifica la ubicación en el momento de la fichada (GPS o QR de la sede).

### 8. forms

- **MVP:** módulo `tasks` de `core` (submódulo `forms`).
- **Rol:** constructor de formularios dinámicos.
- **Qué hace:** guarda definiciones de formularios con campos tipados (`text`, `number`, `yes_no`, `select`, `checklist`, `photo`, `qr`), una `key` estable, un `label` y un indicador `required`. La lógica condicional y los campos de firma son trabajo futuro.
- **Versionado:** un formulario es un borrador mientras es editable; al publicarlo se congela una `FormVersion` inmutable. Las tareas y las respuestas apuntan a la versión que usaron.
- **Solicitud-respuesta:** `tasks.form.create` / `update` / `publish` / `get` / `list`.

### 9. tasks

- **MVP:** módulo `tasks` de `core`.
- **Rol:** trabajo a realizar en cada sede.
- **Qué hace:** tareas únicas (asignadas a un empleado o a una sede/puesto, con una fecha límite y una versión de formulario publicada) y tareas por turno generadas a partir de plantillas de tareas cuando llega `shift_started`. Las reglas de recurrencia (RRULE) más allá de las plantillas son trabajo futuro.
- **Toma de tareas:** una tarea asignada a una sede/puesto puede ser tomada, o respondida directamente, por cualquier empleado con un turno en curso en esa sede y puesto; gana la primera toma.
- **Ejecución:** recibe la respuesta, la valida contra la versión del formulario y verifica que el QR escaneado coincida con el esperado (por ejemplo, un punto de ronda). Las respuestas sin conexión se deduplican por `clientAnswerId`.
- **Estados:** `pending`, `completed`, `expired` y `cancelled`. La revisión por un supervisor (`approved` u `observed`) se registra en la respuesta y no cambia el estado.
- **Solicitud-respuesta:** `tasks.task-template.create` / `update` / `list` y `tasks.task.create` / `get` / `list` / `claim` / `answer` / `review`.
- **Publica:** `t.<tenant>.tasks.task_assigned`, `task_completed` y `task_expired`.
- **Consume:** `t.<tenant>.organization.shift_started` (genera las tareas por turno) y `shift_cancelled` (cancela las pendientes), además de los eventos de estado del tenant y de plan.

### 10. media

- **MVP:** módulo `tasks` de `core` (submódulo `media`).
- **Rol:** fotos adjuntas a las respuestas de las tareas.
- **Qué hace:** emite URL prefirmadas para subir directamente a un almacenamiento compatible con S3, guarda metadatos (`mime`, `sizeBytes`, `sha256`, `takenAt`, quien la sube y la clave de almacenamiento) y entrega URL prefirmadas de descarga de corta duración. Límites: 10 MB y `image/jpeg`, `image/png` o `image/webp`.
- **Solicitud-respuesta:** `tasks.media.request-upload` y `tasks.media.get-url`.
- **Futuro:** miniaturas, metadatos de GPS y del dispositivo, firmas y otros adjuntos, y retención automática según el plan (eventos como `photo_uploaded` y `photo_processed`).

### 11. rules

- **MVP:** servicio `telemetry` (dominio `attendance`, submódulo `alerts`), con umbrales fijos. El motor de reglas configurable es **futuro**.
- **Rol:** generador de alertas. Es el cerebro operativo.
- **Qué hace hoy:** cuatro tipos de alerta con umbrales fijos: `late` (10 minutos después del inicio del turno sin `in`), `uncovered_post` (15 minutos sin nadie fichado, también cuando el turno no tiene empleado), `out_of_geofence` y `missing_clock_out` (fin del turno + 2 horas con un `in` abierto). La detección se dispara con los eventos de turnos de `organization` y una verificación periódica cada minuto; las alertas son una funcionalidad Pro.
- **Ciclo de vida de la alerta:** `open`, `acknowledged` por un supervisor de la sede o un admin, `resolved` (manualmente, o automáticamente cuando llega la fichada para `late` y `uncovered_post`, o cuando se agrega la salida para `missing_clock_out`).
- **Solicitud-respuesta:** `attendance.alert.list` / `acknowledge` / `resolve`.
- **Publica:** `t.<tenant>.attendance.alert_opened`, `alert_acknowledged` y `alert_resolved`.
- **Futuro:** un servicio `rules` dedicado con reglas configurables por tenant (umbrales, salida anticipada, tarea vencida, cobertura mínima de la sede) y su propio estado en NATS KV.

### 12. emergencies

- **MVP:** ninguno. Es un servicio **futuro** (el reemplazo automático por emergencia queda fuera del alcance del MVP).
- **Rol:** asignación automática de turnos de emergencia.
- **Qué hará:** ante una alerta `uncovered_post`, pedirá candidatos a `organization` (`organization.employee.list-available`) y los ordenará por puntaje: disponibilidad, distancia a la sede (última posición en KV), habilidades, horas acumuladas en la semana y descanso legal.
- **Oferta:** envía la oferta a los 3 mejores a la vez, con 5 minutos para responder; si nadie acepta, pasa a los siguientes. Tras 3 rondas escala al supervisor.
- **Sin condiciones de carrera:** la aceptación usa una actualización compare-and-set (revisión esperada) en NATS KV sobre la clave de la emergencia; el primero en aceptar se queda con el turno y al resto se le avisa que ya fue cubierto.
- **Publica (futuro):** `t.<tenant>.emergencies.emergency_started`, `emergency_offered`, `emergency_accepted` y `emergency_escalated`.
- **Consume (futuro):** `t.<tenant>.attendance.alert_opened` (tipo `uncovered_post`) y `t.<tenant>.attendance.clock_event_recorded` (cancela la emergencia si el empleado original llegó tarde).

### 13. notifications

- **MVP:** módulo `notifications` de `core` (solo push e in-app).
- **Rol:** entrega de mensajes. No tiene lógica de negocio.
- **Qué hace:** push (FCM) a los tokens de dispositivo activos del destinatario y notificaciones in-app guardadas y listadas para la web; plantillas en código identificadas por `(templateCode, locale)` (hoy solo `es`), registro de entregas y hasta 3 intentos. El correo, el SMS, WhatsApp, las preferencias del usuario y las horas de silencio son trabajo futuro.
- **Solicitud-respuesta:** `notifications.push-token.register` / `unregister` y `notifications.notification.list` / `unread-count` / `mark-read`.
- **Consume:** el genérico `t.<tenant>.notifications.send` (usado por `billing` para sus avisos), `t.<tenant>.attendance.alert_opened` (supervisores de la sede) y `t.<tenant>.tasks.task_assigned` (el empleado asignado), además de los eventos de estado del tenant y de plan. Los destinatarios se resuelven al enrutar con `auth.user.list-recipients` y `organization.employee.get`.
- **Publica:** nada en el MVP; `notification_sent` y `notification_failed` son eventos futuros.

### 14. tower

- **MVP:** servicio `telemetry` (dominio `attendance`, submódulo `tower`).
- **Rol:** Torre de Control en tiempo real.
- **Qué hace:** ante cada fichada o cambio de alerta, emite `t.<tenant>.attendance.site_summary_updated` con `siteId`, `expected` (empleados asignados de los turnos en curso), `present` (fichados y sin salida) y `openAlerts`. No tiene base de datos propia más allá de los datos de attendance (schema `attendance` de `telemetry`). La Torre de Control es una funcionalidad Pro.
- **Conexión del navegador:** el navegador no se conecta a NATS. Abre un WebSocket (Socket.IO) hacia `telemetry`, que valida el token con `auth.token.verify`, une el socket a una sala por cada sede permitida (supervisor: sus `siteIds`; `owner`/`admin`: todas las sedes del tenant), se suscribe del lado del servidor a los eventos de resumen y los reenvía a la sala de la sede (ver [gateway](#1-gateway)). La Torre no conoce los WebSockets: solo publica los resúmenes.
- **Estado inicial:** `attendance.tower.snapshot` (solicitud-respuesta) devuelve la imagen actual cuando se abre el panel; después todo llega como eventos.
- **Futuro:** un servicio `tower` dedicado que publique `t.<tenant>.tower.summary.<site>` y que además agregue ubicaciones y emergencias.

### 15. reports

- **MVP:** ninguno. Es un servicio **futuro**.
- **Rol:** lectura y analítica (CQRS).
- **Qué hará:** construirá tablas de lectura alimentadas por eventos: asistencia diaria, horas por empleado, cobertura por sede, cumplimiento de tareas y tiempos de respuesta a alertas.
- **Exportaciones:** Excel y PDF para que el cliente pueda enviarlos a su cliente final; los envíos programados salen por `notifications`.
- **Consume:** casi todos los eventos de dominio.

### 16. billing

- **MVP:** módulo `billing` de `core`.
- **Rol:** planes, suscripciones, facturación y cobranza.
- **Planes y precios:** el catálogo `basic` y `pro` con un precio mensual fijo en ARS y las funcionalidades que habilita cada plan. Solo un `platform_admin` cambia precios y funcionalidades, y un nuevo precio se aplica desde la factura siguiente.
- **Suscripción:** estados `trial`, `active`, `past_due`, `suspended` y `cancelled`, gobernados por una máquina de estados pura. Con `t.<tenant>.auth.tenant_created` crea la prueba `pro` de 14 días. Una mejora de plan es inmediata; una reducción se aplica al inicio del período siguiente; la cancelación se hace efectiva a fin de mes y puede deshacerse antes; volver a suscribirse crea una nueva suscripción.
- **Facturación:** cierre mensual por período vencido el día 1, con una línea de plan y una línea de IVA del 21 % separada, sin punto flotante (`Decimal`, redondeo half-up por línea) y una factura emitida inmutable (se corrige anulándola).
- **Pagos:** enlace de pago de Mercado Pago por factura y webhook público (siempre consultando el pago en la API de Mercado Pago), pagos manuales registrados por el `platform_admin` y una conciliación diaria. Todo queda detrás de una interfaz `PaymentProvider`.
- **Solicitud-respuesta:** `billing.plan.list`, `billing.subscription.get` / `change-plan` / `cancel` / `cancel-undo` / `resubscribe`, `billing.invoice.list` / `get` / `payment-link`, `billing.webhook.mercadopago` y las rutas de plataforma `billing.admin.*`.
- **Publica:** `t.<tenant>.billing.subscription_created`, `plan_changed`, `invoice_issued`, `payment_overdue`, `subscription_expired`, `payment_received`, `subscription_cancelled`, `subscription_reactivated` y `data_retention_expired`. Los avisos salen como `t.<tenant>.notifications.send` con los códigos de plantilla `billing_*`.
- **Consume:** `t.<tenant>.auth.tenant_created` y su propio `data_retention_expired` (purga sus datos pero conserva facturas y pagos).
- **Mora, suspensión y retención:** `billing` es dueño de los pagos y los plazos; `auth` es dueño del estado del tenant. Detalle en [Mora, suspensión y cancelación de un tenant](#mora-suspensión-y-cancelación-de-un-tenant).

### Servicios transversales

- **integrations (futuro):** webhooks salientes firmados (HMAC) hacia los sistemas del cliente, una API pública con claves por tenant y exportación de horas a sistemas de liquidación de sueldos. Consume eventos y llama por HTTP hacia afuera.
- **audit (futuro):** consume todos los eventos y guarda un registro inmutable (solo inserción) de quién hizo qué y cuándo. Clave en conflictos laborales. Hoy la única traza de auditoría son las filas de corrección de `attendance` y los ids de actor guardados con cada cambio.

## Base de datos

En el MVP hay una sola base PostgreSQL `teamworkflow`. Cada módulo de `core` y `telemetry` conserva su propio schema (`auth`, `organization`, `tasks`, `notifications`, `billing`, `attendance`), su propio rol, su propio cliente de Prisma y sus propias migraciones; el aislamiento lo garantizan los roles de PostgreSQL y no hay claves foráneas entre schemas. En la arquitectura objetivo, cada microservicio decide si comparte una base con otros servicios (con su propio schema) o tiene la suya.

Lo que queda fijo:

- Cada servicio solo escribe y lee sus propias tablas o su schema.
- Los datos de otros servicios se solicitan por NATS, o se guarda una copia alimentada por eventos. No hay consultas ni claves foráneas entre servicios.
- Cada servicio con datos tiene su propio `prisma/schema.prisma` y sus propias migraciones.
- Toda tabla con datos de clientes lleva `tenantId`. Row Level Security es opcional y solo se aplica cuando varios servicios comparten una base de datos.
- La capa HTTP de `core` (el antiguo `gateway`) no tiene base de datos propia.

El modelo de cada servicio (diagramas entidad-relación y el SQL de referencia original) está en [docs/database.md](docs/database.md).

## Flujos clave y hoja de ruta

### Inicio de sesión y acceso

1. El usuario envía su correo y contraseña a la API de `core` (`/api`), que invoca `auth.login` del módulo `auth`.
2. `auth` valida las credenciales (bloqueando tras 5 intentos fallidos) y devuelve un token de acceso (15 minutos) y un token de refresco (7 días).
3. En cada solicitud, la capa HTTP de `core` (y `telemetry`, por NATS) llama a `auth.token.verify` y obtiene `userId`, `tenantId`, `role`, `siteIds` (solo supervisores), `tenantStatus`, `plan` y `features`.
4. Cuando el token de acceso vence, el cliente llama a `auth.token.refresh`, que rota el token de refresco.

Los empleados inician sesión como todos los demás, con correo y contraseña. Su cuenta nace de una invitación generada a partir del registro del empleado (`employee_created`); los supervisores y administradores se invitan directamente.

### Torre de Control

1. El navegador abre un WebSocket (Socket.IO) hacia `telemetry` (`/ws`) y envía el token de acceso.
2. `telemetry` lo valida con `auth.token.verify` (la Torre de Control es una funcionalidad Pro) y une el socket a una sala por cada sede permitida: los `siteIds` del supervisor, o todas las sedes del tenant para `owner` y `admin`.
3. `telemetry` obtiene la instantánea inicial con `attendance.tower.snapshot` (interna de `telemetry`) y la envía al socket.
4. `telemetry` se suscribe del lado del servidor a `t.<tenant>.attendance.site_summary_updated` y reenvía cada mensaje a la sala de su `siteId`. El navegador nunca habla con NATS.

### Mora, suspensión y cancelación de un tenant

1. Una factura sigue impaga después de su vencimiento (día 1 de atraso): `billing` marca la suscripción como `past_due`, publica `t.<tenant>.billing.payment_overdue` y solicita el aviso `billing_overdue_notice` mediante `t.<tenant>.notifications.send`. `auth` pasa el tenant a `past_due` y publica `t.<tenant>.auth.tenant_past_due`. Todo sigue funcionando; el `owner` y los `admin` ven un banner (el frontend lee `tenantStatus` de `auth.token.verify`).
2. En los días 4 y 6 de atraso `billing` solicita el mismo aviso para el `owner` y los `admin`.
3. El día 7 sin pago, `billing` marca la suscripción como `suspended`, publica `t.<tenant>.billing.subscription_expired` y solicita `billing_suspended`. `auth` pasa el tenant a `suspended`, revoca todos los tokens de refresco de supervisores y empleados y publica `t.<tenant>.auth.tenant_suspended`.
4. Mientras está suspendido, los supervisores y empleados no pueden iniciar sesión, refrescar ni pasar `auth.token.verify` (código `tenant_suspended`, devuelto en el login solo después de una contraseña correcta, de modo que no filtra información). El `owner` y los `admin` pueden iniciar sesión, pero la capa HTTP de `core` solo les permite acceder a las rutas de facturación (pagar) y a la exportación de datos; todo lo demás responde 403 `tenant_suspended`.
5. Los servicios que consumen `tenant_suspended` pausan sus procesos automáticos para ese tenant: los jobs de turnos de `organization`, la verificación periódica de `attendance`, la generación y el vencimiento de tareas en `tasks`, y los envíos en `notifications` (los avisos `billing_*` se siguen entregando). Los servicios futuros (`rules`, `emergencies`, `location`) harían lo mismo. Los datos se conservan.
6. En cualquier momento, cuando llega el pago completo, `billing` publica `t.<tenant>.billing.payment_received` (solo cuando no queda otra factura vencida). `auth` pasa un tenant `past_due` o `suspended` a `active` y publica `t.<tenant>.auth.tenant_reactivated`; los servicios reanudan sus procesos y los usuarios vuelven a iniciar sesión con normalidad. Este pago nunca reactiva un tenant `cancelled`.
7. Cuando una suscripción cancelada llega a fin de mes, `billing` emite la última factura, marca la suscripción como `cancelled` y publica `t.<tenant>.billing.subscription_cancelled`. `auth` pasa el tenant a `cancelled` (mismas restricciones que `suspended`), revoca los tokens de refresco de supervisores y empleados y publica `t.<tenant>.auth.tenant_cancelled`; los servicios pausan sus procesos automáticos como en una suspensión.
8. El `owner` o un `admin` puede volver a suscribirse eligiendo un plan (`billing.subscription.resubscribe`): `billing` crea una nueva suscripción activa (sin prueba) y publica `plan_changed` seguido de `t.<tenant>.billing.subscription_reactivated`; `auth` pasa el tenant a `active` y publica `tenant_reactivated`. La primera factura se prorratea desde ese día.
9. A los 90 días de la cancelación (con un aviso `billing_data_deletion_warning` 7 días antes), `billing` publica `t.<tenant>.billing.data_retention_expired` y cada servicio elimina definitivamente los datos del tenant (`tasks` también elimina las fotos del almacenamiento). `billing` conserva facturas y pagos, y `auth` deja un registro mínimo del tenant en estado `deleted`.

### Fichada de entrada

1. El empleado ficha desde la app (`attendance.clock-event.create`) con un `clientEventId` único, la hora del dispositivo y las coordenadas GPS o el QR de la sede escaneado; sin señal, el evento se encola localmente y se envía más tarde.
2. `attendance` resuelve al empleado con `organization.employee.get` y asocia el evento a su turno (desde 60 minutos antes del inicio hasta el fin del turno) usando su copia local de turnos. Verifica la geocerca con los datos de `organization.site.get`: fuera del radio el evento igualmente se acepta, se marca `outOfGeofence` y se abre una alerta `out_of_geofence`.
3. `attendance` guarda la fichada, recalcula la jornada, publica `t.<tenant>.attendance.clock_event_recorded` y resuelve automáticamente cualquier alerta `late` o `uncovered_post` abierta para ese turno.
4. Se actualiza el resumen de la sede afectada y `site_summary_updated` llega a la Torre de Control; un futuro servicio `reports` sumaría la presencia del día.

### Puesto sin cubrir

1. `organization` publica `shift_started` y `attendance` guarda la instantánea del turno; su verificación periódica se ejecuta cada minuto sobre los turnos en curso.
2. A los 10 minutos del inicio sin `in` del empleado asignado, `attendance` abre una alerta `late`; a los 15 minutos sin nadie fichado (o sin empleado asignado), abre una alerta `uncovered_post` y publica `t.<tenant>.attendance.alert_opened`.
3. `notifications` consume `alert_opened`, resuelve los supervisores de la sede con `auth.user.list-recipients`, guarda la notificación in-app y envía el push; la Torre de Control muestra la alerta.
4. Un supervisor reconoce la alerta (`attendance.alert.acknowledge`) y la atiende, por ejemplo reasignando el turno manualmente (`organization.shift.reassign`, usando `organization.employee.list-available` para encontrar candidatos).
5. Cuando un reemplazo ficha, `attendance` resuelve la alerta automáticamente (`alert_resolved`).
6. **Futuro:** un servicio `emergencies` consumiría la alerta `uncovered_post`, ofrecería el turno a los 3 mejores candidatos, resolvería la carrera con compare-and-set y publicaría `emergency_accepted` para que `organization` reasigne el turno.

### Tarea con formulario y foto

1. Con `shift_started`, `tasks` genera las tareas por turno del puesto del turno (si el plan incluye tareas) y publica `task_assigned`; `notifications` avisa al empleado asignado.
2. El empleado abre la tarea; la app obtiene la versión publicada del formulario y solicita una URL prefirmada con `tasks.media.request-upload` para cada foto.
3. La app sube las fotos directamente al almacenamiento y llama a `tasks.task.answer` con las respuestas, los ids de media y el QR escaneado.
4. `tasks` verifica la media subida, valida las respuestas contra la versión del formulario y el QR esperado, marca la tarea como completada y publica `task_completed`. Un supervisor puede luego revisarla con `tasks.task.review`.

### Hoja de ruta sugerida

1. **MVP (3 a 4 meses):** los 2 servicios del [MVP](#mvp): `core` (capa HTTP, auth, organization con sites, employees y shifts, tasks con formularios, tareas y fotos, notifications y billing) y `telemetry` (attendance con alertas y la Torre de Control). Suficiente para vender los planes Basic y Pro.
2. **Fase 2:** `reports`, alertas y reglas configurables, notificaciones por correo y SMS, y un backoffice de plataforma ampliado.
3. **Fase 3:** `emergencies`, `location` con historial, `integrations`, `audit` y SSO (trabajo futuro). Habilita Enterprise.
4. **Fase 4:** extraer módulos de `core` a servicios propios cuando la carga o el equipo lo justifiquen, dividir `organization` en sites, employees y shifts, mover `location` y `reports` a sus propias bases de datos, y predicción de ausentismo con los datos históricos.
