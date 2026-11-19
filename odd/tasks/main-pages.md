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
- [ ] M1 Patrones compartidos: selector segmentado, encabezado de página, barras de progreso y filas de lista.
- [ ] M2 Panel principal.
- [ ] M3 Torre de Control (mapa de sedes, alertas, estado por sede; orden en el celular).
- [ ] M4 Asistencia (semana, línea de tiempo de jornadas, fichadas, celular).
- [ ] M5 Sedes, lista (mapa general y tarjetas).
- [ ] M6 Facturación (plan actual, comparación, medio de pago, facturas).
- [ ] M7 Mi jornada (botón de fichar, GPS, fichadas y jornadas).
- [ ] M8 Revisar cada página en 1280 y 390 px, en claro y oscuro, contra las capturas; `pnpm lint` y `pnpm build`.
