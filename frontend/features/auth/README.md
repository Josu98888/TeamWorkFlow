# Módulo de Autenticación (Auth)

Este documento describe cómo el frontend de TeamWorkFlow consume la autenticación del backend. El antiguo API Gateway ya no existe: su capa HTTP y el microservicio `auth` se fusionaron en el servicio `core` (monolito modular NestJS), que expone la API pública bajo `/api/v1`. Ver [`docs/architecture.md`](../../../docs/architecture.md).

## 🚀 Cómo ejecutar el proyecto

### Backend (`core` + NATS + PostgreSQL)

Requiere `backend/.env` con `POSTGRES_PASSWORD`, las seis `*_DB_PASSWORD` y `JWT_SECRET` (mínimo 32 caracteres).

```bash
cd backend
docker compose up --build -d
# Primera vez (o tras una migración nueva): aplicar las migraciones de auth
docker compose exec core pnpm prisma:auth:migrate:deploy
```

`core` queda en `http://localhost:3000/api/v1`.

### Frontend

El frontend corre en otro puerto porque `core` usa el 3000:

```bash
cd frontend
pnpm install
pnpm dev -p 3002
```

Variable de entorno del frontend (`frontend/.env.local`, solo del lado del servidor):

```bash
BACKEND_URL=http://localhost:3000/api/v1
```

---

## 🔌 Cómo llamar a la API

Antes las peticiones iban al Gateway; ahora van a `core`, con las mismas reglas:

- **Siempre desde el servidor de Next.js**: Server Actions (`domains/auth/actions.ts`) y Server Components, usando el helper `backendFetch` con `BACKEND_URL` (ver la skill `teamworkflow-nextjs`). `core` todavía no tiene CORS, así que el navegador no puede llamarlo directamente. Nunca usar `fetch` a `core` desde un Client Component.
- **Base URL**: `BACKEND_URL` + ruta, por ejemplo `POST ${BACKEND_URL}/auth/login`. En producción un reverse proxy publica todo bajo un mismo origen: `/api/v1/telemetry` y `/ws` van a `telemetry` y el resto de `/api/v1` a `core`.
- **Autenticación**: las rutas protegidas exigen `Authorization: Bearer <accessToken>`. `core` todavía no usa cookies: el frontend guarda los tokens en cookies `httpOnly` propias (escritas desde la Server Action) y reenvía el `accessToken` en el header en cada llamada.
- **Tokens**: login, registro y aceptar invitación devuelven `{ accessToken, refreshToken, expiresIn }` (`expiresIn` en segundos; access token de 15 minutos por defecto, refresh token de 7 días). Cuando el access token vence (401 `invalid_token`), llamar a `POST /auth/refresh` con el `refreshToken`: devuelve un par nuevo y el refresh token anterior deja de servir (rotación).
- **Errores**: siempre `{ detail, code }`. Los errores de validación (422 `validation_error`) agregan `errors: [{ field, constraints }]`. Usar `code` para elegir el mensaje y `errors` para marcar los campos del formulario.
- **El actor nunca va en el body**: `core` lo toma del token. Enviar `actor`, `tenantId` o cualquier campo extra en el body responde 422.

### Endpoints disponibles

| Método y ruta | Acceso | Body | Respuesta |
|---|---|---|---|
| `POST /auth/register` | público | `{ tenantName, name, email, password }` (password de 8 a 128) | 201 tokens |
| `POST /auth/login` | público | `{ email, password }` | 201 tokens |
| `POST /auth/refresh` | público | `{ refreshToken }` | 201 tokens |
| `POST /auth/logout` | Bearer | `{ refreshToken }` | 201 `{ ok: true }` |
| `POST /auth/invitations/accept` | público | `{ token, name, password }` | 201 tokens |
| `POST /auth/password-reset/confirm` | público | `{ token, password }` | 201 `{ ok: true }` |
| `GET /auth/invitations` | Bearer, owner/admin | — | 200 `[{ invitationId, email, role, expiresAt }]` |
| `POST /auth/invitations` | Bearer, owner/admin | `{ email, role }` (`admin`, `supervisor`, `employee`) | 201 `{ invitationId, token, expiresAt }` |
| `POST /auth/invitations/:invitationId/regenerate` | Bearer, owner/admin | — | 201 `{ invitationId, token, expiresAt }` |
| `PATCH /auth/users/:userId/role` | Bearer, owner/admin | `{ role }` | 200 |
| `PUT /auth/users/:userId/sites` | Bearer, owner/admin | `{ siteIds: string[] }` | 200 |
| `POST /auth/users/:userId/deactivate` | Bearer, owner/admin | — | 201 |
| `POST /auth/users/:userId/password-reset` | Bearer, owner/admin | — | 201 `{ token, expiresAt }` |

Un `admin` solo puede gestionar `supervisor` y `employee`; el `owner` gestiona a todos. Si no tiene permiso, la respuesta es 403 `forbidden`.

### Códigos de error de auth

| `code` | Status | Cuándo | Mensaje sugerido |
|---|---|---|---|
| `invalid_credentials` | 401 | Email o contraseña incorrectos en login | "Email o contraseña incorrectos" |
| `invalid_token` | 401 | Access token ausente o vencido, refresh token inválido o reutilizado, token de invitación o de reseteo inválido | Refrescar el token o volver al login |
| `email_taken` | 409 | Registro o invitación con un email que ya existe | "El correo ya está registrado" |
| `forbidden` | 403 | Rol sin permiso para la operación | "No tienes permiso para esta acción" |
| `tenant_suspended` / `tenant_cancelled` | 403 | Un `supervisor` o `employee` de un tenant suspendido o cancelado intenta loguearse, refrescar o aceptar una invitación | Pantalla informativa; contactar al administrador |
| `validation_error` | 422 | Body inválido o con campos extra | Marcar los campos con `errors` |

---

## 🛠 Lo que se puede empezar a hacer

Todo lo de esta lista ya tiene backend funcionando y probado (tests e2e y prueba de login sobre `docker compose`).

### 1. Login (`/login`)
- Formulario `email` y `password` → Server Action → `POST /auth/login`.
- Guardar `accessToken` y `refreshToken` en cookies `httpOnly` y redirigir al dashboard.
- Errores: `invalid_credentials` (mensaje genérico), `tenant_suspended` / `tenant_cancelled` (pantalla informativa).

### 2. Registro (`/register`)
- Formulario `tenantName`, `name`, `email`, `password` → `POST /auth/register`. Crea el tenant y su `owner`, y devuelve tokens (queda logueado).
- Errores: `email_taken` (409), `validation_error` (422).

### 3. Logout y renovación de sesión
- Logout: `POST /auth/logout` con el Bearer y el `refreshToken`, después borrar las cookies.
- Renovación: un helper de servidor que, ante un 401 `invalid_token`, llame a `POST /auth/refresh`, reescriba las cookies y reintente la petición una sola vez. Si el refresh falla, redirigir a `/login`.

### 4. Aceptar invitación (`/invitation/accept/[token]`)
- El token llega en la URL; formulario `name` y `password` → `POST /auth/invitations/accept` con `{ token, name, password }`. Devuelve tokens: el usuario queda logueado.
- Errores: `invalid_token` (invitación inválida, vencida o ya usada).

### 5. Confirmar reseteo de contraseña (`/password-reset/confirm/[token]`)
- Formulario con la nueva `password` → `POST /auth/password-reset/confirm` con `{ token, password }`. Después redirigir a `/login`.
- No hay "olvidé mi contraseña" por email: el reseteo lo genera un `owner` o `admin` desde la gestión de usuarios (punto 7), y le pasa el enlace al usuario.

### 6. Invitaciones (panel de `owner` / `admin`)
- Lista de invitaciones pendientes (`GET /auth/invitations`).
- Crear (`POST /auth/invitations`) y regenerar (`POST .../regenerate`). La respuesta trae el `token` una sola vez: armar el enlace `/invitation/accept/<token>` y mostrarlo para copiar. Todavía no se envían emails.

### 7. Gestión de usuarios (panel de `owner` / `admin`)
- Cambiar rol, asignar sedes, desactivar y generar un reseteo de contraseña (devuelve el `token` para armar `/password-reset/confirm/<token>`).
- Limitación: todavía no hay un endpoint para listar usuarios del tenant ni un `GET /auth/me`. Estas pantallas necesitan el `userId`, así que conviene esperar esos endpoints o empezar por la parte de formularios.

---

## 💡 Consideraciones técnicas

- **Datos del usuario logueado**: no existe `GET /auth/me`. El `accessToken` es un JWT con `sub` (id del usuario), `tenantId` y `role`, sin nombre ni email. Se puede decodificar en el servidor para decidir qué menú mostrar, pero los permisos reales los valida siempre el backend.
- **Estado del tenant**: `owner` y `admin` pueden entrar aunque el tenant esté `suspended` o `cancelled` (para regularizar el pago); `supervisor` y `employee` reciben 403. Mostrar un banner cuando el tenant está `past_due` queda pendiente: todavía no hay un endpoint que devuelva ese estado.
- **Todavía no existe en `core`**: cookies, CSRF, CORS, rate limit, `@Roles` y el módulo `billing`.

---

## Estado actual

- Backend (`core`, módulo `auth`): implementado y verificado (tests unitarios, e2e contra PostgreSQL y NATS reales, y login probado sobre `docker compose`).
- API: `core` bajo `/api/v1`, con `AuthGuard` global, `ValidationPipe` y errores `{ detail, code }`.
- Frontend: **pendiente**.
