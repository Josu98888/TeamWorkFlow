# Rediseño de las páginas principales

## Objective
Rediseñar las 6 pantallas centrales del producto con el estilo aprobado (vidrio violeta, botones teal, cards con brillo violeta): Panel principal, Torre de Control, Asistencia, Sedes (lista), Facturación y Mi jornada.

## Design reference
Prototipo aprobado por el usuario (2026-11-19), en `odd/designs/main-pages/`:

- `preview.html`: todas las páginas. Se elige con `?view=panel|torre|asistencia|sedes|factura|jornada` y el tema con `&theme=dark`. Incluye el sidebar y la barra de arriba solo como contexto: NO son parte de esta tarea. No se copia tal cual (ver Constraints).
- Una captura por página (`panel-principal.png`, `torre-de-control.png`, `asistencia.png`, `sedes.png`, `facturacion.png`, `mi-jornada.png`), cada una en compu y celu, en claro y oscuro.
- Los datos del prototipo son de ejemplo; en la app salen de las APIs y mocks actuales.

## Dependencies
Se apoya en las otras ramas de diseño. Hacerlas antes, o reutilizar sus tokens si ya están:

- `design/frontend/glow-cards` (`odd/tasks/glow-cards.md`): `Card` con `glow` y el nuevo `KpiTile`. Todas las filas de números de estas páginas usan ese `KpiTile` (chip con ícono, valor, pastilla de tono).
- `design/frontend/site-detail` (`odd/tasks/site-detail.md`): el estilo del mapa (geocerca, marcadores, zoom, pastillas sobre el mapa). Torre y Sedes lo reusan.
- `design/frontend/sidebar-glass` (`odd/tasks/sidebar-glass.md`): el contenedor `main` como tarjeta.

## Shared patterns
- **Encabezado de página (`PageHeader`):** título de 24 px en negrita, descripción gris y acciones a la derecha (contorno + principal teal). En el celular se oculta la acción secundaria.
- **Selector segmentado:** fondo `--bg-alt`, opción activa como pastilla `--bg-card`. Reemplaza los `FilterChip` donde son excluyentes (pestañas o filtros de estado).
- **Barras de progreso:** violeta (`--brand-medium` → `--brand-lavender`) para lo general, teal para lo trabajado o cumplido, amarillo y rojo para lo que tiene problemas.
- **Filas de lista:** separadores finos, avatar o chip de ícono, título, subtítulo gris y etiqueta (`Badge`) a la derecha.
- **Celular (menos de 760 px):** KPI en 2 columnas sin el texto largo; las grillas pasan a una columna.

## 1. Panel principal (`features/home/components/HomeOverview.tsx`)
- **Bienvenida** (card `glow="bottom"`): etiqueta con el nombre de la empresa, "Buenas tardes, {nombre}" (saludo según la hora), un resumen del día ("Hoy hay N personas en turno en M sedes. X puestos necesitan atención") y los botones "Abrir Torre de Control" (principal) y "Ver turnos de hoy" (secundario).
- **Recuadro de prueba** a la derecha, solo si la suscripción está en `trial`: días que quedan, barra, fecha de fin y "Elegir plan" (→ `/facturacion`).
- **KPI** (los 4 actuales): Sedes activas, Presentes ahora, Alertas activas, Tareas pendientes.
- **Accesos directos:** los 3 actuales (Torre, Sedes, Tareas) como cards con brillo: chip de ícono, título, descripción y "Entrar →". Suben 3 px al pasar el mouse.
- **Actividad reciente:** últimas alertas y eventos (chip de color según el tipo, texto y hace cuánto). Usar los datos que ya hay en los mocks/APIs (alertas, fichadas); si no hay una fuente, dejar la card con un `EmptyState` y anotarlo.
- **Cumplimiento de tareas:** anillo con el porcentaje y tres barras (completadas, pendientes, vencidas). Hoy ya hay un dato de cumplimiento en esta pantalla; reusarlo.
- Respetar los permisos: el empleado no ve esta pantalla como hoy, y los accesos se filtran con `canAccessRoute`.

## 2. Torre de Control (`features/telemetry/components/TowerView.tsx`)
- Selector de sede (todas o una) en el encabezado.
- **KPI** actuales: Presentes ahora, Cobertura, Alertas abiertas, Reconocidas.
- **Mapa de todas las sedes** (420 px; 300 px en el celular): cada sede es un círculo punteado con un centro que muestra `presentes/esperados` y su nombre debajo. Violeta si está completa, amarillo si falta gente y rojo con un pulso si tiene una alerta abierta. Leyenda abajo a la izquierda. Tocar una sede la filtra.
- **Alertas** (columna derecha, `glow="bottom"`): "En vivo" con un punto que late, selector segmentado con contadores (Activas, Abiertas, Reconocidas…) y cada alerta como card con una barra de color a la izquierda según la gravedad. Muestra etiqueta, título, hora, quién/dónde y los botones Reconocer, Resolver y "Ver en mapa" (centra la sede). Una alerta nueva lleva un borde rojo suave unos segundos.
- **Estado del personal por sede:** filas con nombre, detalle (puestos, problemas), barra de cobertura del color del estado, etiqueta y `presentes/esperados`. Selector Todas / Con problemas.
- En el celular las alertas van PRIMERO, después el mapa y después el estado por sede; el zoom del mapa se oculta.
- Mantener `useTowerLive`, los filtros y `acknowledgeAlert` / `resolveAlert` como hoy.

## 3. Asistencia (`features/telemetry/components/AttendanceView.tsx`)
- Encabezado con "Exportar" (si no existe la función, dejar el botón fuera) y "Fichada manual" (principal).
- Filtros: selector segmentado Jornadas / Fichadas (las dos pestañas actuales), selects de sede y empleado, y un navegador de semana (← "16 al 22 nov" →).
- **Tira de la semana:** 7 días como tarjetas con un punto por jornada (verde bien, amarillo tarde, rojo fuera de geocerca). El día elegido va con un degradé violeta.
- **Jornadas del día (compu):** una línea de tiempo de 06 a 22 h con una fila por empleado: avatar, nombre, sede y puesto; el turno programado como un recuadro punteado lavanda y lo trabajado como una barra (teal, amarillo si llegó tarde, rojo si estuvo fuera de la geocerca, con rayas si sigue en curso). A la derecha, las horas trabajadas y una etiqueta (Tarde N min, Fuera de geocerca, Corregida, Programado, En turno). Una línea roja marca "Ahora" si el día es hoy.
- **Celular:** cada jornada es una tarjeta con su barra, la entrada, la salida y la etiqueta.
- **Pestaña Fichadas:** mantener la tabla actual con el estilo de tabla del kit (encabezado gris en mayúsculas, filas con hover, etiquetas); en el celular, como tarjetas.
- Leyenda de colores debajo. Tocar una jornada abre el "Detalle de la jornada" actual.
- Mantener filtros, carga y estados vacíos actuales.

## 4. Sedes, lista (`features/organization/components/SitesView.tsx`)
- Encabezado con "Nueva sede".
- **Mapa general** (230 px; 180 px en el celular) con todas las sedes con el mismo estilo de la Torre (más chicas, con la inicial) y una pastilla "N sedes · M activas".
- Buscador y selector Todas / Activas / Inactivas.
- **Grilla de tarjetas** (3 columnas, 2 en tablet y 1 en el celular): arriba un mini mapa de 120 px con la geocerca y el marcador, y la etiqueta de estado encima. Debajo van el nombre, la dirección, tres datos en cajitas (Geocerca, Personal, Turnos ahora — los que ya muestra la pantalla), los avatares apilados del personal y una barra de cobertura con su porcentaje. Toda la tarjeta lleva al detalle.
- El mini mapa puede ser un estilo estático (sin Leaflet) para no cargar un mapa por tarjeta.

## 5. Facturación (`features/billing/components/BillingView.tsx`, `SubscriptionPanel.tsx`)
- **Plan actual** (card con brillo): etiqueta de estado (`SUBSCRIPTION_LABELS`/`TONES`), el nombre del plan grande, el precio por mes + IVA (`formatMoney`) y lo que incluye con tildes. A la derecha, en `trial`, un recuadro con los días que quedan en grande, una barra, la fecha de fin y los botones. En los otros estados, el próximo cobro o el aviso del estado (`STATUS_NOTICES`).
- **Comparación de planes:** dos cards, Básico y Pro, con el precio de `plans` (hoy $ 100.000 y $ 180.000 + IVA), una descripción y la lista de funciones (tilde o cruz, según `features`). Pro va destacado (borde violeta medio, `glow="bottom"`, etiqueta "Tu plan" o "Recomendado"). Los botones usan las acciones existentes (`changePlan`, cancelar, deshacer la cancelación, volver a suscribirse) y se respetan sus reglas y textos (por ejemplo, "Pasar a Básico se aplica al inicio del próximo período…").
- **Medio de pago:** dos opciones seleccionables, Mercado Pago y Transferencia (borde teal y anillo en la elegida). Si hoy no hay un endpoint para elegirlo, mostrarlo solo como información y anotarlo.
- **Facturas:** la tabla actual (`InvoiceTable`, `InvoiceModal`) con el estilo de tabla del kit, o el `EmptyState` actual con el círculo violeta.
- Es pantalla de venta: textos claros, sin letra chica escondida y con los precios con IVA aclarado.

## 6. Mi jornada (`features/telemetry/components/MyShiftView.tsx`), mobile-first
- **Card del turno de hoy** (`glow`): etiquetas "Turno de hoy" y el horario, sede y puesto, y la dirección.
- **Botón grande de fichar:** círculo de 142 px con un degradé teal, el ícono de huella, "Fichar entrada" o "Fichar salida" según corresponda y cuánto falta. Lleva un anillo de progreso alrededor (el tiempo hasta el turno o del turno en curso) y un pulso suave. Usa el formulario de fichada actual (turno, tipo y QR opcional) por detrás; si hay más de un turno posible, pedir cuál en un selector antes de fichar.
- Debajo, el estado del GPS como una pastilla (verde "Estás dentro de la sede · N m", amarillo/rojo si está fuera; la fichada se acepta igual, pero queda marcada). Luego "Escanear QR" (abre el `QrScanner` actual) y "Actualizar ubicación".
- **Tareas del turno** (si hay datos de tareas): filas con chip de ícono, nombre, frecuencia y etiqueta.
- **Mis fichadas:** línea de tiempo (punto teal en la entrada, violeta en la salida, punteado si está pendiente) con hora y método (GPS o QR, y "Fuera de geocerca" si corresponde).
- **Mis jornadas:** filas con la fecha en un cuadrado lavanda, la sede, una barra de horas trabajadas sobre las programadas, las horas a la derecha y la etiqueta "Tarde" si corresponde.
- Mantener la lógica actual (fichada, escáner, estados vacíos).

## Constraints
- NO cambiar la lógica, las llamadas a la API, los permisos ni los estados de carga, vacío y error de ninguna pantalla: es un cambio visual.
- Seguir `teamworkflow-frontend`, `teamworkflow-react` y `teamworkflow-tailwind`: tokens semánticos, `cn()`/`cva`, sin `#hex` en JSX. Componentes nuevos reutilizables en `shared/components` (por ejemplo `Segmented`, `Timeline`, `ProgressRing`) y los propios de cada dominio en su `features/<dominio>/components`.
- Si una pantalla necesita un dato que hoy no existe (actividad reciente, medio de pago, cobertura por día), no inventarlo en el backend: usar lo que hay y anotar lo que falta en el PR.
- Sin dependencias nuevas sin confirmarlo con el equipo.

## Tasks
- [x] M1 Patrones compartidos: selector segmentado, encabezado de página, barras de progreso y filas de lista.
  - Evidence: `Segmented`, `PageHeader` (`badge`, `secondaryActions`, hidden on phones), `ProgressBar` tones `brand` and `done`, `RowList variant="lines"`, `KpiTile compact`, `Avatar muted` in `frontend/shared/components` (7412800).
- [ ] M2 Panel principal.
- [ ] M3 Torre de Control (mapa de sedes, alertas, estado por sede; orden en el celular).
- [ ] M4 Asistencia (semana, línea de tiempo de jornadas, fichadas, celular).
- [x] M5 Sedes, lista (mapa general y tarjetas).
  - Evidence: `SitesOverviewMap` (Leaflet, initial markers, pill), `Segmented` filter + search, card grid 1/2/3 with `SiteTilePreview` (one lazy OSM tile + CSS ring/pin), stats, stacked avatars, assignment bar, one OSM attribution line (e14ab4a).
- [ ] M6 Facturación (plan actual, comparación, medio de pago, facturas).
- [ ] M7 Mi jornada (botón de fichar, GPS, fichadas y jornadas).
- [ ] M8 Revisar cada página en 1280 y 390 px, en claro y oscuro, contra las capturas; `pnpm lint` y `pnpm build`.

## Adjustments (decided 2026-11-19)
The user asked to use the prototype as a guide, not to the letter, and to pick what works better. Changes against the spec above:

- **Site detail joins this feature.** `odd/tasks/site-detail.md` (D1-D4) is done here first, because Torre and Sedes reuse its map style. Its D5 visual check merges into M8.
- **Real maps instead of the drawn one.** Torre and the Sedes overview use the existing Leaflet map with each site at its real coordinates; the prototype's dotted circle with `presentes/esperados` becomes the marker (`divIcon`), with the same muted tiles as the site detail. Reason: a drawn map lies about where the sites are, and Leaflet is already in the app.
- **Mini maps in the Sedes cards** are one static OSM tile image per card (no Leaflet instance per card), lazy-loaded, with the geofence ring drawn in CSS on top. One OSM attribution line on the page.
- **No invented numbers.** Deltas such as "+4 % respecto de ayer" or "Esperan respuesta" appear only when the data exists; otherwise the tile shows the hint only.
- **Greeting without a name.** The session carries no user name (see `sidebar-glass`), so the welcome says "Buenas tardes" plus the company name when available.
- **Mi jornada on the phone:** the clock-in card, then today's punches (they confirm what the employee just did), then the shift tasks, then the history.
- **QR:** text plus "Copiar" and "Imprimir", no QR library (needs team approval).

## Delivery
Branch `feat/frontend/main-pages`, stacked on `feat/frontend/list-pages`; the design commits of `design/frontend/site-detail` and `design/frontend/main-pages` were cherry-picked. Route: delegated, one writer at a time in this order: (1) M1 + site detail D1-D4 + M5 Sedes, (2) M3 Torre + M2 Panel, (3) M7 Mi jornada + M4 Asistencia, (4) M6 Facturación. One commit per page. Forecast ~2,000+ lines: PRs sliced per page later. TDD off (no frontend unit runner); checks `pnpm lint`, `npx tsc --noEmit`, `pnpm build`.

## Progress
- Designs received and adjustments recorded. Next: writer 1.
- Writer 1 done: M1, site detail D1-D4 and M5 (commits 7412800, 9a926eb, e14ab4a). `pnpm lint` (2 pre-existing warnings), `npx tsc --noEmit`, `pnpm build` run; no browser, so no visual check yet (M8).
- Deviations of writer 1: (1) the site map no longer fakes "adentro/fuera" counts: the API has no per-person geofence status, so the pill reads "N en turno" and the red ring/"fuera" pill appear only when `MapPersonMarker.outside` is set (Torre can use it with real data); person markers stay spread deterministically inside the geofence as before. (2) Geofence fill is a flat lavender with opacity, not a radial gradient: Leaflet paths are SVG and take no CSS radial gradient. (3) Sedes cards' coverage bar shows "turnos con persona asignada / turnos del día" (real data) instead of presence percentage, with teal when complete and warning otherwise; no per-site alert state exists, so card badges are only Activa/Inactiva. (4) Sedes map markers use `ok`/`off` states only for the same reason. (5) The QR print view is a popup with the code as text, escaped HTML and no color tokens (print document). (6) Site detail "Alertas" tile replaced by Turnos de hoy (no alert source in the organization feature).
