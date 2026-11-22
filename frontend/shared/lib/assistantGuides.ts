import type { Role } from '@/shared/auth/permissions';

export type AssistantGuide = {
  id: string;
  question: string;
  category: 'Mi jornada' | 'Torre de Control' | 'Sedes y Turnos' | 'Tareas' | 'Asistencia';
  roles?: readonly Role[];
  steps: string[];
  route?: {
    label: string;
    href: string;
  };
  keywords: string[];
};

const MANAGERS: readonly Role[] = ['owner', 'admin', 'supervisor'];
const OWNER_ADMIN: readonly Role[] = ['owner', 'admin'];
const EMPLOYEE_ONLY: readonly Role[] = ['employee'];

export const ASSISTANT_GUIDES: AssistantGuide[] = [
  {
    id: 'employee-clock-in',
    question: '¿Cómo ficho entrada, descanso o salida?',
    category: 'Mi jornada',
    roles: EMPLOYEE_ONLY,
    steps: [
      'Ingresá a "Mi jornada" en el menú lateral.',
      'Seleccioná el turno activo y el tipo de fichada: Entrada, Inicio de descanso, Fin de descanso o Salida (para marcar Salida necesitás haber fichado la Entrada antes).',
      'Elegí el método QR (escaneando el código impreso en tu sede) o GPS según corresponda, aceptando los permisos de cámara y ubicación.',
      'Confirmá el registro y verificá que tu jornada quede en estado "Abierta" (o "Cerrada" al salir).',
    ],
    route: { label: 'Ir a Mi jornada', href: '/mi-jornada' },
    keywords: ['fichar', 'qr', 'gps', 'entrada', 'salida', 'descanso', 'jornada', 'marcar', 'turno'],
  },
  {
    id: 'employee-tasks',
    question: '¿Cómo respondo una tarea asignada?',
    category: 'Tareas',
    roles: EMPLOYEE_ONLY,
    steps: [
      'Dentro de "Mi jornada", bajá hasta la sección de tus tareas pendientes.',
      'Abrí la tarea (puede ser de frecuencia Única o Por turno) y completá los campos solicitados: Texto, Número, Sí / No, Selección única, Lista de verificación, Foto o Código QR.',
      'Guardá y enviá las respuestas para que el estado pase de "Pendiente" a "Completada".',
    ],
    route: { label: 'Ir a Mi jornada', href: '/mi-jornada' },
    keywords: ['tarea', 'responder', 'completar', 'foto', 'checklist', 'formulario', 'pendiente'],
  },
  {
    id: 'control-tower-alerts',
    question: '¿Cómo gestiono una alerta en Torre de Control?',
    category: 'Torre de Control',
    roles: MANAGERS,
    steps: [
      'Entrá a "Torre de Control" en el menú Operación para monitorear el mapa y la lista de alertas en tiempo real.',
      'Identificá el tipo de alerta: "Llegada tarde", "Puesto sin cubrir", "Fuera de geocerca" o "Salida sin fichar".',
      'Hacé clic en "Ver en mapa" para centrar la sede afectada y presioná "Reconocer" para cambiar su estado de "Abierta" a "Reconocida" mientras la gestionás.',
      'Una vez resuelto el incidente, marcala como "Resuelta" para cerrarla.',
    ],
    route: { label: 'Ir a Torre de Control', href: '/torre-control' },
    keywords: ['alerta', 'torre', 'reconocer', 'resolver', 'geocerca', 'tarde', 'puesto', 'sin cubrir', 'mapa'],
  },
  {
    id: 'sites-geofence-qr',
    question: '¿Cómo creo una sede, geocerca o QR?',
    category: 'Sedes y Turnos',
    roles: OWNER_ADMIN,
    steps: [
      'Ingresá a "Sedes y Geocercas" en el menú Operación.',
      'Creá una nueva sede definiendo su nombre, ubicación en el mapa y radio de geocerca para validar las fichadas por GPS.',
      'Entrá al detalle de la sede para configurar sus puestos operativos y descargar o rotar el código QR físico que escanearán los empleados.',
    ],
    route: { label: 'Ir a Sedes y Geocercas', href: '/sedes' },
    keywords: ['sede', 'geocerca', 'radio', 'qr', 'rotar', 'puesto', 'sucursal', 'mapa'],
  },
  {
    id: 'shifts-assignment',
    question: '¿Cómo programo y asigno turnos?',
    category: 'Sedes y Turnos',
    roles: MANAGERS,
    steps: [
      'Abrí "Turnos" en la sección Gestión del menú lateral.',
      'Creá un nuevo turno seleccionando la sede, el puesto, el empleado asignado y la franja horaria.',
      'El turno quedará en estado "Programado", pasará a "En curso" al iniciar y alimentará la cobertura en vivo de la Torre de Control.',
    ],
    route: { label: 'Ir a Turnos', href: '/turnos' },
    keywords: ['turno', 'programar', 'asignar', 'horario', 'cobertura', 'empleado', 'puesto'],
  },
  {
    id: 'tasks-forms-manager',
    question: '¿Cómo creo formularios y asigno tareas?',
    category: 'Tareas',
    roles: MANAGERS,
    steps: [
      'Andá a "Tareas y Reportes" en el menú Operación.',
      'Si sos Propietario o Administrador, podés diseñar plantillas de formularios con campos de Texto, Número, Sí / No, Selección única, Lista de verificación, Foto o Código QR.',
      'Creá una tarea indicando si es "Única" o "Por turno" y asignala a la sede o personal correspondiente para auditar su cumplimiento ("Pendiente", "Completada" o "Vencida").',
    ],
    route: { label: 'Ir a Tareas y Reportes', href: '/tareas' },
    keywords: ['tarea', 'formulario', 'reporte', 'checklist', 'foto', 'auditoria', 'crear tarea'],
  },
{
    id: 'attendance-correction',
    roles: ['owner', 'admin', 'supervisor'],
    category: 'Asistencia',
    question: '¿Cómo corrijo una fichada o salida sin marcar?',
    keywords: ['asistencia', 'corregir', 'manual', 'sin salida', 'fichada', 'fichar', 'entrada', 'salida', '24 horas', 'jornada'],
    steps: [
      'Ingresá a "Asistencia" dentro de la sección Gestión del menú lateral.',
      'En la tabla de fichadas hacé clic en "Corregir" sobre el registro que necesites ajustar, o usá el botón superior "Fichada manual" para cargar una Entrada o Salida faltante.',
      'En la tabla de jornadas podés filtrar por estado (por ejemplo "Sin salida") y presionar "Ver detalle" para auditar la jornada completa.',
    ],
    route: { label: 'Ir a Asistencia', href: '/asistencia' },
  },
];

export const TEAMWORKFLOW_SYSTEM_PROMPT = `Sos el asistente operativo integrado de TeamWorkFlow, una plataforma SaaS de gestión de personal en campo, sedes con geocercas, turnos, fichadas y control operativo en tiempo real.

Reglas estrictas para tus respuestas:
1. Respondé siempre en español rioplatense claro, directo y accionable (usá "vos": abrí, ingresá, hacé clic, filtrá, revisá).
2. Adaptá la respuesta estrictamente al rol del usuario indicado en el contexto:
   - employee: solo puede usar "Mi jornada" (/mi-jornada), "Tareas y Reportes" (/tareas) y "Notificaciones" (/notificaciones). Nunca le indiques opciones de Torre de Control, Turnos, Sedes, Empleados, Usuarios ni Facturación.
   - supervisor: puede operar Torre de Control, Sedes y Geocercas (lectura), Tareas y Reportes, Notificaciones, Empleados, Turnos y Asistencia. No gestiona Usuarios ni Facturación.
   - admin: tiene acceso operativo completo incluyendo Usuarios (/usuarios), excepto Facturación (/facturacion) y Facturación plataforma (/plataforma/facturacion).
   - owner: acceso total a la operación, Usuarios (/usuarios) y Facturación (/facturacion).
3. PROHIBIDO inventar o parafrasear nombres de botones, secciones o estados: citá ÚNICAMENTE los nombres literales del mapa de abajo entre comillas.
4. No menciones APIs internas, endpoints REST, bases de datos ni código fuente.
5. Mantené las respuestas concisas (máximo 5 pasos numerados o 2 párrafos breves).

Mapa exacto de navegación, botones reales y reglas de negocio por pantalla:
- Barra superior: botones "SIMULAR EMPLEADO" (solo owner/admin en modo demo), "TEMA OSCURO" / "TEMA CLARO", "SALIR", y campana de notificaciones. Barra lateral: "Cerrar sesión".
- Torre de Control (/torre-control):
  * Estados de alerta: "Abierta", "Reconocida", "Resuelta".
  * Filtros: "Activas", "Abiertas", "Reconocidas", "Resueltas", selector "Todas las sedes", filtro de sedes "Todas" / "Con problemas", y botón "Ver todas".
  * Botones en cada alerta: "Reconocer", "Resolver", "Ver en mapa".
- Mi jornada (/mi-jornada, rol employee):
  * Botones: "Escanear QR con la cámara" (abre lector QR con botón "Cerrar cámara") y botón principal "Registrar Entrada" / "Registrar Salida" (requiere GPS activo y estar dentro del radio en metros de la geocerca de la sede).
  * Validaciones: no permite registrar salida sin una entrada previa abierta ni fichar fuera de geocerca sin dejar marca de "Fuera de geocerca".
- Asistencia (/asistencia):
  * Botón superior: "Fichada manual" (para registrar una entrada o salida manual asociando empleado, sede, turno y fecha/hora).
  * Tabla de fichadas: columna "Origen" ("QR", "Manual") y botón por fila "Corregir" (para editar/corregir una fichada existente).
  * Tabla de jornadas: estados de jornada ("Sin salida", "En curso", "Completa", etc.) y botón por fila "Ver detalle".
- Turnos (/turnos):
  * Botón superior: "Nuevo turno".
  * Botones por fila en turnos activos: "Editar", "Reasignar", "Cancelar".
  * Estados de turno: "Programado", "En curso", "Finalizado", "Cancelado".
- Sedes y Geocercas (/sedes y /sedes/[id]):
  * En listado: botón "Nueva sede".
  * En detalle de sede: botones "Editar", "Nuevo puesto", y en la tarjeta QR de la sede botones "Copiar" / "Copiado", "Imprimir" y botón de rotación de QR.
- Tareas y Reportes (/tareas y /tareas/formularios):
  * En /tareas: botones "Formularios" y "Nueva tarea". En "Mis tareas" (empleados): botones "Responder", "Reclamar", y dentro de respuestas con QR "Escanear QR con la cámara".
  * En /tareas/formularios: botón "Nuevo formulario". En el constructor: botones "Agregar campo", "Subir", "Bajar", "Quitar", "Guardar borrador" y "Publicar versión" (sin una versión publicada no se pueden crear tareas).
- Empleados (/empleados):
  * Botones: "Nuevo empleado" y "Editar" por fila. Filtros: "Todos", "Activos", "Inactivos".
- Usuarios (/usuarios, solo owner/admin):
  * Botones por usuario: "Rol", "Sedes", "Enlace de contraseña", "Desactivar", y en el modal del enlace "Copiar enlace" y "Listo".
- Notificaciones (/notificaciones):
  * Botones: "Marcar todas como leídas", "Anterior", "Siguiente".
- Facturación (/facturacion, solo owner):
  * Botones: "Ver detalle", "Pagar", "Volver a suscribirme", "Deshacer cancelación".`;

export function getGuidesForRole(role?: string | null): AssistantGuide[] {
  if (!role) return ASSISTANT_GUIDES;
  const filtered = ASSISTANT_GUIDES.filter(
    (guide) => !guide.roles || guide.roles.includes(role as Role),
  );
  return filtered.length > 0 ? filtered : ASSISTANT_GUIDES;
}

export function findLocalFallbackGuide(query: string, role?: string | null): AssistantGuide | null {
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const pool = getGuidesForRole(role);
  let bestMatch: AssistantGuide | null = null;
  let bestScore = 0;

  for (const guide of pool) {
    const score = guide.keywords.reduce(
      (acc, keyword) => (normalized.includes(keyword) ? acc + 1 : acc),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestMatch = guide;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

export type AllowedRoute = {
  href: string;
  label: string;
  roles: string[];
};

export const ALLOWED_ASSISTANT_ROUTES: AllowedRoute[] = [
  { href: '/mi-jornada', label: 'Ir a Mi jornada', roles: ['employee'] },
  { href: '/', label: 'Ir a Panel principal', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/torre-control', label: 'Ir a Torre de Control', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/sedes', label: 'Ir a Sedes y Geocercas', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/tareas', label: 'Ir a Tareas y Reportes', roles: ['owner', 'admin', 'supervisor', 'employee'] },
  { href: '/tareas/formularios', label: 'Ir a Formularios', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/notificaciones', label: 'Ir a Notificaciones', roles: ['owner', 'admin', 'supervisor', 'employee'] },
  { href: '/empleados', label: 'Ir a Empleados', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/turnos', label: 'Ir a Turnos', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/asistencia', label: 'Ir a Asistencia', roles: ['owner', 'admin', 'supervisor'] },
  { href: '/usuarios', label: 'Ir a Usuarios', roles: ['owner', 'admin'] },
  { href: '/facturacion', label: 'Ir a Facturación', roles: ['owner'] },
];

export function resolveAllowedRoute(href: string | null | undefined, role: string | null | undefined) {
  if (!href) return null;
  const normalizedRole = (role ?? 'employee').toLowerCase();
  const match = ALLOWED_ASSISTANT_ROUTES.find(
    (route) => route.href === href && route.roles.includes(normalizedRole),
  );
  return match ? { href: match.href, label: match.label } : null;
}