# Detalle de sede: mapa con geocerca, QR y puestos

## Objective
Rediseñar el detalle de sede (`app/(dashboard)/sedes/[siteId]`, componente `features/organization/components/SiteDetailView.tsx`) con números arriba, un mapa grande con la geocerca y el personal, una card de QR y la lista de puestos con su estado.

## Design reference
Prototipo aprobado por el usuario (2026-11-18), en `odd/designs/site-detail/`:

- `preview.html`: referencia visual (acepta `?theme=dark`). Incluye la barra de arriba y el sidebar solo para dar contexto; esta tarea es SOLO el contenido de la página. No se copia tal cual (ver Constraints).
- `desktop.png`, `mobile.png`: claro y oscuro.

## Related designs
Usa el estilo de las otras ramas de diseño: las cards con brillo violeta (`odd/tasks/glow-cards.md`, rama `design/frontend/glow-cards`) y los tokens de la app. Si `glow-cards` todavía no está hecha, aplicar el brillo localmente con los mismos tokens (`--glow-1`, `--glow-2`) y no inventar valores nuevos.

## Layout
1. **Encabezado (`PageHeader`):** nombre de la sede + etiqueta Activa/Inactiva al lado del título; abajo la dirección y "Geocerca de N m" (`formatMeters`). Acciones a la derecha: "Editar" (contorno) y "Nuevo puesto" (principal, teal). Mantener el botón de volver (`back`) y el permiso `sites.manage` (`Can`).
2. **Tres números chicos** (cards con brillo en la esquina): Presentes (`presentes/esperados` de hoy), Puestos (activos) y Alertas (abiertas de la sede, si el dato está disponible; si no, Turnos de hoy). En el celular siguen en 3 columnas, más compactas.
3. **Grilla:** mapa a la izquierda (2/3) y columna derecha (1/3) con el QR y los puestos. En el celular se apila: mapa, QR, puestos.

## Map (`SiteMap`, Leaflet)
- Card de 380 px de alto (300 px en el celular), radio de 22 px, sin padding.
- Tiles con un estilo apagado que combine con la app: en claro, OSM con un filtro suave (por ejemplo `filter: saturate(.35) brightness(1.05)` sobre el panel de tiles); en oscuro, invertido (`invert(1) hue-rotate(180deg) brightness(.85) saturate(.4)`). Sin proveedores ni dependencias nuevas.
- Geocerca: círculo con borde violeta medio punteado (2 px) y relleno lavanda radial semitransparente.
- Marcador de la sede: gota violeta con degradé (`--brand-medium` → `--brand-primary`) y el ícono de edificio en blanco.
- Personal activo (`activePersonnel`): avatares redondos con iniciales (28 px). Quien está fuera de la geocerca lleva un anillo rojo (`--status-danger`).
- Controles de zoom propios: dos botones cuadrados redondeados (`+` / `−`) arriba a la derecha, con el estilo de los botones de ícono.
- Abajo a la izquierda, dos pastillas de vidrio sobre el mapa: "N adentro" (verde) y "N fuera de geocerca" (rojo; ocultar si es 0).

## QR card
- Título "QR de la sede", el QR en un recuadro blanco de 120 px con radio de 16 px (blanco también en modo oscuro, para que se pueda escanear), un texto chico de cuándo se renovó y los botones "Renovar" (secundario) e "Imprimir" (contorno).
- Hoy `RotateQrButton` devuelve `qrCode` como texto y lo muestra en un modal. Para dibujar el QR como imagen hace falta una librería (por ejemplo `qrcode`): CONFIRMAR con el equipo antes de agregarla. Mientras tanto, mostrar el código con el botón "Copiar" dentro de la card, con este mismo estilo.
- "Imprimir" abre una vista simple con el QR grande, el nombre y la dirección de la sede (`window.print`).

## Posts list
- Cada fila tiene: avatar de quien cubre el puesto (o un círculo gris con "?" si no hay nadie), el nombre del puesto, el horario debajo y una etiqueta a la derecha: **Cubierto** (verde), **Fuera** (rojo, si la persona está fuera de la geocerca), **Sin cubrir** (amarillo) o **Inactivo** (gris).
- Separadores finos entre filas; tocar una fila abre `PostFormModal` como hoy.
- Las secciones actuales de **Personal habilitado** y **Turnos de hoy** se mantienen debajo de la grilla, como cards con el mismo estilo (filas con avatar y etiqueta), sin brillo o con `glow="none"`.

## Constraints
- Mantener toda la lógica actual de `SiteDetailView`: carga, "Sede no encontrada", estados vacíos, `SiteFormModal`, `PostFormModal`, `RotateQrButton`, permisos `Can` y `reload`.
- Seguir `teamworkflow-frontend`, `teamworkflow-react` y `teamworkflow-tailwind`: tokens semánticos, sin `#hex` en JSX.
- Sin dependencias nuevas sin confirmarlo con el equipo (ver QR).

## Tasks
- [ ] D1 Encabezado con etiqueta de estado, dirección, geocerca y acciones; los tres números chicos.
- [ ] D2 Grilla mapa + columna derecha; estilo del mapa (tiles, geocerca, marcador, avatares, zoom y pastillas).
- [ ] D3 Card de QR con renovar, copiar e imprimir (y la imagen del QR si el equipo aprueba la librería).
- [ ] D4 Lista de puestos con avatar y estado; Personal habilitado y Turnos de hoy con el mismo estilo.
- [ ] D5 Revisar en 1280 y 390 px, en claro y oscuro, contra las capturas; `pnpm lint` y `pnpm build`.
