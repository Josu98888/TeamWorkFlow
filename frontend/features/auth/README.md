# Módulo de Autenticación (Auth)

Este documento detalla la implementación del servicio de autenticación en el frontend de TeamWorkFlow, consumiendo la API Gateway construida sobre NestJS.

## 🚀 Cómo ejecutar el proyecto

Para desarrollar este módulo, necesitas tener el backend funcionando y el frontend en su puerto específico.

### Backend (Microservicios)
Desde la carpeta raíz del backend:

```bash
# Para levantar toda la infraestructura (NATS, PostgreSQL, Gateway, Auth, etc.)
cd backend
docker compose up --build
```

### Frontend
El frontend debe correr en un puerto distinto al del Gateway para evitar conflictos:

```bash
cd frontend
pnpm install
pnpm dev -p 3002
```

---

## 🛠 Páginas a implementar

### 1. Login (`/login`)
*   **Acción:** Formulario con `email` y `password`.
*   **Lógica:**
    *   Enviar petición POST a `/api/v1/auth/login`.
    *   Manejar errores: Mostrar error genérico 401 si las credenciales fallan.
    *   Estado del Tenant: Si el backend responde con un error de `tenant_suspended` o `tenant_cancelled` después de un login exitoso, redirigir o mostrar un banner informativo.
    *   Redirección: Redirigir al Dashboard principal tras un login exitoso.

### 2. Registro (`/register`)
*   **Acción:** Formulario con `tenantName`, `name`, `email`, `password`.
*   **Lógica:**
    *   Enviar petición POST a `/api/v1/auth/register`.
    *   Manejar errores: `email_taken` (409) si el usuario ya existe.

### 3. Aceptar Invitación (`/invitation/accept/[token]`)
*   **Acción:** El usuario entra mediante un enlace recibido. El token viene en la URL.
*   **Formulario:** `name`, `password`.
*   **Lógica:**
    *   Enviar petición POST a `/api/v1/auth/password-reset/confirm` (o el endpoint correspondiente de invitación) usando el token de la URL.
    *   Manejar errores: Token inválido/expirado (401).

### 4. Recuperación de Contraseña
*   **Paso 1: Solicitud (`/password-reset`)**: Input de `email`. Enviar POST a `/api/v1/auth/password-reset/create`.
*   **Paso 2: Confirmación (`/password-reset/confirm/[token]`)**: Input de nueva `password`. Enviar POST a `/api/v1/auth/password-reset/confirm`.

---

## 💡 Consideraciones técnicas

*   **API Gateway**: Todas las peticiones van a `/api/v1/...`.
*   **AuthGuard**: El Gateway protege las rutas automáticamente. Tu app debe manejar la persistencia del token (si usas cookies, esto es automático; si usas `Authorization: Bearer`, debes manejarlo en el `localStorage` o `cookies` de forma segura).
*   **Mapeo de Errores**: El backend devuelve los errores en formato `{ detail: "message", code: "error_code" }`. Utiliza el `code` para mostrar mensajes amigables al usuario (ej. `email_taken` -> "El correo ya está registrado").
*   **Tenant Status**: Tras el login, verificar el estado del tenant. Si está `past_due`, mostrar un banner de advertencia. Si está `suspended` o `cancelled`, bloquear acceso a la mayoría de las rutas y redirigir a la página de billing.

---

## Estado Actual
*   Backend (Auth): Implementado, verificado y testeado (fases 0-10).
*   Gateway: Configurado con `AuthGuard` y `ValidationPipe`.
*   Frontend: **Pendiente**.
