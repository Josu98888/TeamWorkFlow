# Debilidades Arquitectónicas Identificadas y Resoluciones Implementadas

## 1. Ausencia de Transactional Outbox (Pérdida Silenciosa de Eventos) — **RESUELTO**

- **Riesgo original:** Guardar la entidad en la base de datos dentro de una transacción y emitir el evento a NATS JetStream inmediatamente después sin respaldo. Si NATS caía o sufría un timeout en ese instante, la transacción quedaba confirmada pero el evento se perdía silenciosamente.
- **Solución implementada:**
  - En `backend/core`: Se implementó `OutboxRelay` + `PrismaOutboxStore` / `InMemoryOutboxStore` (`src/common/outbox/`) integrado en `JetStreamService` (`auth`), `OrganizationEventsService` (`organization`) y `BillingEventsService` (`billing`), con reintentos con *exponential backoff* e idempotencia mediante `{ msgID: eventId }`.
  - En `backend/telemetry`: Se incorporó cola Outbox transaccional y relay automático (`enqueueOutbox` / `flushOutbox`) en `JetStreamService` (`src/nats/jetstream.service.ts`) garantizando reentrega con `{ msgID: eventId }`.

## 2. La Torre de Control WebSocket no Escala Horizontalmente — **RESUELTO**

- **Riesgo original:** `TowerGateway` emitía únicamente a las salas Socket.IO en la memoria local del proceso que originaba el resumen, por lo que múltiples réplicas de `telemetry` tras un balanceador no recibían los eventos generados en otras réplicas.
- **Solución implementada:**
  - `JetStreamService` (`backend/telemetry/src/nats/jetstream.service.ts`) expone suscripciones broadcast por proceso (`registerBroadcastHandler`).
  - `TowerGateway` (`backend/telemetry/src/tower/tower.gateway.ts`) se suscribe a nivel de proceso a `t.*.attendance.site_summary_updated`, valida que el `tenantId` del subject coincida con el `tenantId` del payload, deduplica por `eventId` para no emitir dos veces en la réplica de origen (`recordLocalBroadcast`), y retransmite a las salas locales `{tenantId}:{siteId}` y `{tenantId}:all`.

## 3. Verificación de Auth Síncrona por NATS en cada Fichada — **RESUELTO**

- **Riesgo original:** `POST /api/v1/telemetry/clock-events` dependía en cada request de una llamada síncrona `auth.token.verify` por NATS hacia `core`, deteniendo las fichadas si `core` estaba lento o reiniciando.
- **Solución implementada:**
  - `NatsClientService` (`backend/telemetry/src/nats/nats-client.service.ts`) incorpora caché en memoria de corto TTL (`AUTH_CACHE_TTL_MS`, invalidada automáticamente ante eventos `tenant_suspended` / `tenant_cancelled` / `tenant_reactivated` en `AuthConsumer`) y verificación criptográfica local HS256 (`verifyHs256JwtLocally` con `JWT_SECRET`) como fallback resiliente ante `UpstreamUnavailableException` / `UpstreamTimeoutException`.
  - `AuthGuard` (`backend/telemetry/src/http/guards/auth.guard.ts`) consulta el estado local de `TenantStateService` (`TenantState` y `TenantFeatures` en la base de datos propia de `telemetry`) para hacer cumplir suspensiones y features de plan incluso cuando `core` no está disponible.

## 4. Fragilidades en el Frontend — **RESUELTO**

- **Riesgo original:** Almacenar JWTs en `localStorage` exponía las sesiones a ataques XSS, y la falta de rotación automática ante `401` y refresh proactivo causaba desconexiones abruptas al expirar el access token de 15 minutos.
- **Solución implementada:**
  - En `backend/core`: `AuthController` (`src/auth/auth.controller.ts`) emite cookies `httpOnly`, `SameSite=Lax` (`access_token`, `refresh_token`) más cookie CSRF (`csrf_token`) e hidrata `refreshToken` desde la cookie en `/auth/refresh` y `/auth/logout`; `AuthGuard` (`src/http/guards/auth.guard.ts`) acepta `access_token` por cookie y valida `X-CSRF-Token` en métodos mutantes.
  - En `frontend`: `shared/lib/http.ts`, `app/login/page.tsx`, `app/register/page.tsx`, `app/(dashboard)/layout.tsx` y `components/layout/Sidebar.tsx` eliminaron el almacenamiento de JWTs en `localStorage`, envían `credentials: 'include'` + `X-CSRF-Token`, rotan automáticamente el token con lock *single-flight* ante respuestas `401` y ejecutan refresh proactivo antes del vencimiento del access token.
