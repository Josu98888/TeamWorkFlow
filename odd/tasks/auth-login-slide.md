# Login / Registro con panel deslizante

## Objective
Reemplazar las pantallas `app/login` y `app/register` por una sola experiencia de autenticación con un panel violeta que se desliza entre "Iniciar sesión" y "Crear cuenta", sobre un fondo oscuro con formas geométricas, usando los colores de la app.

## Design reference
Prototipo aprobado por el usuario (2026-11-18), en `odd/designs/auth-login-slide/`:

- `preview.html`: HTML/CSS/JS autocontenido. Es la referencia visual y de animación; NO se copia tal cual (ver Constraints).
- `desktop-login.png`, `desktop-register.png`: computadora y tablet (más de 720 px).
- `mobile-login.png`, `mobile-register.png`: celular (720 px o menos).

## Behaviour
- **Computadora y tablet (más de 720 px):** tarjeta de dos mitades. Login: formulario a la izquierda, panel a la derecha con "¡Hola!" y el botón "Registrarme". Al tocarlo, el panel se desliza a la izquierda (0.7 s, `cubic-bezier(.65,0,.35,1)`) y aparece el registro a la derecha; el panel muestra "¡Bienvenido de nuevo!" y "Iniciar sesión" para volver. Los radios del panel se invierten al moverse (`150px 0 0 110px` ↔ `0 150px 110px 0`).
- **Celular (720 px o menos):** igual pero vertical: formulario arriba y panel abajo; en registro el panel sube y el formulario baja. Los textos del panel cambian con fundido.
- Respetar `prefers-reduced-motion`.
- Las URLs siguen existiendo: `/login` abre la vista de login y `/register` la de registro (el mismo componente con un estado inicial distinto). Al cambiar de vista se actualiza la URL sin recargar (`router.replace` o `history.replaceState`).

## Visual
- Fondo: degradé `--bg-sidebar` (oscuro) → `--brand-dark` → `--brand-primary`, con barras diagonales redondeadas, anillos y dos líneas verticales en lavanda/teal con poca opacidad; algunas flotan lento.
- Tarjeta: vidrio (`rgba(255,255,255,.06)`, `backdrop-filter: blur(18px)`, borde blanco al 12 %), radio 28 px, sombra profunda.
- Panel: degradé `--brand-medium` → `--brand-primary` → `--brand-dark` con un brillo lavanda; texto blanco; botón contorneado blanco.
- Inputs tipo píldora translúcidos; foco con borde `--brand-mint`.
- Botón principal: degradé `--brand-teal`. Subrayados y acentos en `--brand-mint`. Marca "TeamWorkFlow" en `--brand-lavender`.
- Esta pantalla es siempre oscura, aunque el tema de la app sea claro.

## Content (español, igual que hoy)
- Login: Email, Contraseña, "¿Olvidaste tu contraseña?" (→ `/password-reset`), botón "Ingresar".
- Registro: Empresa (`tenantName`), Tu nombre (`name`), Email, Contraseña (mínimo 8), botón "Crear cuenta", nota "14 días de prueba gratis".
- Sin botones de login social (el backend no los soporta).

## Constraints
- Mantener TODA la lógica actual de `app/login/page.tsx` y `app/register/page.tsx`: `startSession('/auth/login' | '/auth/register', …)`, mensajes de error (429, `tenant_suspended`, `tenant_cancelled`, 401), estado de carga y redirección a `/`.
- Seguir `teamworkflow-frontend`, `teamworkflow-react` y `teamworkflow-tailwind`: solo tokens semánticos (agregar al `@theme inline` lo que falte, sin colores sueltos en componentes); nada de `#hex` en JSX.
- Ubicación sugerida: `features/auth/components/AuthSlider.tsx` (+ formularios separados), usado por las dos páginas.
- Sin dependencias nuevas: la animación es CSS (transform/opacity).
- Accesibilidad: labels con `htmlFor`, el formulario oculto con `inert`/`aria-hidden`, foco al primer campo al cambiar de vista.

## Tasks
- [x] A1 Componente `AuthSlider` con fondo, tarjeta, panel y animación (escritorio y celular).
  - Evidence: `frontend/features/auth/components/AuthSlider.tsx`, `AuthShell.tsx`, `features/auth/auth.css`, `.auth-screen` tokens in `app/globals.css`; `pnpm lint` (2 known warnings), `npx tsc --noEmit`, `pnpm build` OK; commit d8a641f.
- [x] A2 Mover los formularios actuales de login y registro adentro, sin cambiar su lógica.
  - Evidence: `LoginForm.tsx`, `RegisterForm.tsx` with the same `startSession` calls and error messages; commit d8a641f.
- [x] A3 `/login` y `/register` usan el componente con el estado inicial correcto; sincronizar la URL.
  - Evidence: `app/login/page.tsx` and `app/register/page.tsx` render `AuthSlider` with `initialView`; URL synced with `history.replaceState`; commit d8a641f.
- [ ] A4 Revisar en 1200, 820 y 390 px contra las capturas; `pnpm lint` y `pnpm build`.
- [x] A5 Pantallas públicas de empleados: `/invitations/accept` (el empleado crea su contraseña desde la invitación) y `/password-reset` usan el mismo fondo y tarjeta de vidrio, una sola columna, sin panel deslizante. Lógica sin cambios. Decisión del usuario (2026-11-18): los empleados entran por el mismo `/login` (no hay login aparte en el backend), así que "el login de los empleados" es esta pantalla de invitación.
  - Evidence: `features/access/components/PublicTokenForms.tsx` now uses `AuthShell` + `AuthCard` (logic untouched); lint, tsc, build OK; commit 0246e4c.

## Delivery
- Rama `design/frontend/auth-login-slide` (sale de `develop`). Ruta: delegada (writer trigger, 2+ archivos no triviales). TDD: off (el frontend no tiene runner de unit tests); checks: `pnpm lint`, `npx tsc --noEmit`, `pnpm build`.
- Pronóstico: ~400-550 líneas; estrategia `ask-on-risk`.
- Nota: `feat/frontend/quick-wins` cambió `app/register/page.tsx` (aviso de prueba); al integrar las dos ramas en `develop` habrá conflicto en ese archivo. Este diseño ya incluye la nota de 14 días, así que se resuelve quedándose con esta versión.

## Progress
- Diseño aprobado y spec escrito. A1, A2, A3 y A5 implementados (d8a641f, 0246e4c); lint, tsc y build en verde. Pendiente A4: revisión visual del usuario a 1200, 820 y 390 px (no verificada en navegador).
