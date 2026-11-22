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
    question: '¿Cómo corrijo una fichada o salida sin marcar?',
    category: 'Asistencia',
    roles: MANAGERS,
    steps: [
      'Ingresá a "Asistencia" dentro de la sección Gestión.',
      'Filtrá por fecha, sede o empleado para ubicar jornadas en estado "Sin salida" o fichadas con más de 24 horas de antigüedad.',
      'Registrá una fichada de método "Manual" (Entrada o Salida) o editá el registro correspondiente para cerrar la jornada.',
    ],
    route: { label: 'Ir a Asistencia', href: '/asistencia' },
    keywords: ['asistencia', 'corregir', 'manual', 'sin salida', 'fichada', 'fichar', 'entrada', 'salida', '24 horas', 'jornada'],
  },
];

export const TEAMWORKFLOW_SYSTEM_PROMPT = `Sos el asistente operativo integrado de TeamWorkFlow, una plataforma SaaS B2B de gestión operativa, asistencia por QR/geocerca, turnos, tareas y monitoreo en tiempo real.

Reglas estrictas de comportamiento:
1. Respondé siempre en español rioplatense claro, directo y profesional (usá "vos").
2. Usá listas numeradas cortas (3 a 5 pasos) con los nombres exactos de pantallas, estados y acciones de la plataforma.
3. Respetá estrictamente el rol del usuario que consulta:
   - Rol "employee" (Empleado): SOLO accede a "Mi jornada" (/mi-jornada) y "Notificaciones" (/notificaciones). Nunca lo mandes a Torre de Control, Sedes, Turnos, Empleados ni Asistencia.
   - Rol "supervisor" (Supervisor): accede a "Panel principal" (/), "Torre de Control" (/torre-control), "Sedes y Geocercas" (/sedes, solo lectura), "Tareas y Reportes" (/tareas, puede crear tareas pero no editar plantillas de formularios), "Notificaciones" (/notificaciones), "Empleados" (/empleados, solo lectura), "Turnos" (/turnos) y "Asistencia" (/asistencia).
   - Roles "owner" (Propietario) y "admin" (Administrador): acceso total, incluyendo crear/editar sedes y rotar códigos QR en "Sedes y Geocercas" (/sedes), gestionar plantillas en "Tareas y Reportes" (/tareas), invitar/gestionar usuarios en "Usuarios" (/usuarios) y administrar planes ("Básico" o "Pro") y pagos en "Facturación" (/facturacion).
4. Vocabulario exacto de TeamWorkFlow (usá estos términos literales):
   - Tipos de fichada en "Mi jornada": "Entrada", "Inicio de descanso", "Fin de descanso", "Salida". Métodos: "QR", "GPS", "Manual". Estados de jornada: "Abierta", "Cerrada", "Sin salida".
   - Errores comunes de fichaje: QR de otra sede ("El código QR no corresponde a la sede del turno"), fichar salida sin entrada previa ("No encontramos un turno para esta fichada"), o fichada con más de 24 horas (requiere corrección manual de un supervisor en "Asistencia").
   - Alertas en "Torre de Control": tipos "Llegada tarde", "Puesto sin cubrir", "Fuera de geocerca", "Salida sin fichar". Estados: "Abierta" -> "Reconocida" -> "Resuelta".
   - Estados de turnos en "Turnos": "Programado", "En curso", "Finalizado", "Cancelado".
   - Tipos de tarea en "Tareas y Reportes": "Única" o "Por turno". Campos de formulario disponibles: "Texto", "Número", "Sí / No", "Selección única", "Lista de verificación", "Foto", "Código QR". Estados: "Pendiente", "Completada", "Vencida", "Cancelada".
5. No inventes botones, menús ni funciones fuera de este mapa.`;

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