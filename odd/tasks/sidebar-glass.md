# Sidebar de vidrio con ítem activo fusionado

## Objective
Rediseñar `components/layout/Sidebar.tsx` (y el contenedor de `app/(dashboard)/layout.tsx`) con un sidebar de vidrio semitransparente en modo claro, el violeta oscuro de hoy en modo oscuro, un ítem activo que se fusiona con el contenido y un modo de solo íconos.

## Design reference
Prototipo aprobado por el usuario (2026-11-18), en `odd/designs/sidebar-glass/`:

- `preview.html`: referencia visual e interactiva (botón ☰ y botón de tema). No se copia tal cual (ver Constraints). Acepta `?theme=dark`, `&rail=1` y `&open=1` para ver cada estado.
- `desktop.png`, `tablet.png`, `mobile.png`: cada dispositivo en claro y oscuro, abierto y cerrado.

## Dependency
El botón que oculta o muestra el sidebar ya existe en la rama `feat/frontend/quick-wins`: `shared/providers/SidebarProvider.tsx` (estado, `localStorage` `sidebar-hidden`, media query), el botón ☰ del `Topbar` (`aria-controls={SIDEBAR_ID}`) y el cajón de celular del `Sidebar`. Construir esta tarea ENCIMA de eso (después de que `quick-wins` llegue a `develop`, o en una rama creada desde ella). Reutilizar el provider; no duplicar el estado.

## Layout
- La página tiene el fondo del sidebar, y el contenido (`main`) es una tarjeta `--bg-main` con radio de 28 px y un margen de 10 px arriba, abajo y a la derecha (sin margen a la izquierda, para que el sidebar la toque).
- **Modo claro:** fondo de página `#E9E2EC` con 3 manchas difuminadas (lavanda, menta y violeta medio). Sidebar con un degradé violeta (`--brand-medium` → `--brand-primary` → `--brand-dark`) al 62-74 % de opacidad, `backdrop-filter: blur(22px) saturate(150%)` y un brillo blanco arriba.
- **Modo oscuro:** el violeta oscuro sólido de hoy (`#2B2335` → `#231E2A` → `#1B1720`), sin manchas.

## Sidebar content
- Encabezado: logo redondo (las dos barritas de la marca) + "TeamWorkFlow" / "Gestión operativa" en menta.
- Buscador "Buscar en el menú" que filtra los ítems en vivo.
- Ítems agrupados con títulos de sección: **Operación** (Mi jornada, Panel principal, Torre de Control, Sedes y Geocercas, Tareas y Reportes, Notificaciones), **Gestión** (Empleados, Turnos, Asistencia, Usuarios), **Cuenta** (Facturación, Facturación plataforma). Mantener el filtro `canAccessRoute`; ocultar una sección si queda vacía.
- Ícono de línea por ítem (ver `preview.html`). Si se agrega una librería de íconos, avisar antes (Constraints).
- Contador en Notificaciones (pastilla teal) con el número de no leídas, si ya hay un dato disponible; en modo íconos se ve como un punto menta.
- Pie: tarjeta con avatar (iniciales), nombre, rol (y plan si está disponible) y "Cerrar sesión" en rojo suave (`useLogout`).

## Active item
- Píldora con fondo `--bg-main` que llega hasta el borde derecho del sidebar y se fusiona con la tarjeta de contenido. Tiene dos esquinas cóncavas arriba y abajo (pseudo-elementos de 22 px con `box-shadow` del color `--bg-main`) y una barrita de acento de 3 px a la izquierda (teal en claro, menta en oscuro).
- Texto: `--brand-primary` en claro y blanco en oscuro.

## Behaviour per device (the ☰ button in the Topbar)
- **Computadora (1024 px o más):** el botón alterna entre abierto (264 px, ítem fusionado) y solo íconos (84 px, ítem activo como círculo, tooltips con el nombre). Se guarda en `localStorage` como hoy. Transición de ancho de 0.35 s.
- **Tablet (640 a 1023 px):** siempre visible en modo íconos; el botón lo expande a 264 px ENCIMA del contenido, con sombra y un fondo oscuro detrás. Se cierra con el fondo, con Escape o al navegar.
- **Celular (menos de 640 px):** oculto; el botón abre un cajón flotante (10 px de margen, radio 26 px, de vidrio en claro), con fondo oscuro detrás. Se cierra igual que en tablet.
- En tablet expandido y en celular, el ítem activo es una píldora completa (sin fusión).
- Respetar `prefers-reduced-motion`.

## Constraints
- Seguir `teamworkflow-frontend`, `teamworkflow-react` y `teamworkflow-tailwind`: tokens semánticos (agregar los que falten a `globals.css` y al `@theme inline`, por ejemplo `--sidebar-bg`, `--page-bg`), sin colores `#hex` sueltos en JSX.
- Mantener la accesibilidad de `quick-wins`: `inert` cuando está cerrado, `aria-expanded`/`aria-controls` en el botón, Escape para cerrar y `aria-current="page"` en el ítem activo.
- Sin dependencias nuevas sin confirmarlo con el equipo.

## Tasks
- [ ] S1 Tokens de claro y oscuro (fondo de página, vidrio del sidebar) y contenedor `main` como tarjeta en `(dashboard)/layout.tsx`.
- [ ] S2 Sidebar abierto: encabezado, buscador, secciones con íconos, contador y pie de usuario.
- [ ] S3 Ítem activo fusionado con esquinas cóncavas.
- [ ] S4 Modo solo íconos en computadora con el botón y la preferencia guardada; tablet expandido encima; cajón de celular.
- [ ] S5 Revisar en 1280, 820 y 390 px, en claro y oscuro, contra las capturas; `pnpm lint` y `pnpm build`.
