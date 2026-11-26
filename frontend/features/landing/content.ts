// Copy of the public landing page. Items marked TODO(landing) are pending data from the team.

export const LANDING_PATHS = {
  register: '/register',
  login: '/login',
  terms: '/terminos',
  privacy: '/privacidad',
} as const;

/** Self-hosted video in `public/landing/` (nginx CSP allows media from 'self' only). */
export const LANDING_VIDEO_SRC: string = '/landing/teamworkflow-parodia.mp4';
export const LANDING_VIDEO_POSTER: string = '/landing/teamworkflow-parodia-poster.jpg';

/** Logo of the foundation behind the IntegrarTEC scholarship. */
export const FOUNDATION_LOGO = '/landing/fundacion-integrartec.png';

// TODO(landing): real contact data.
export const LANDING_CONTACT = {
  email: '[EMAIL]',
  whatsappUrl: 'https://wa.me/[NUMERO]',
};

export const NAV_LINKS = [
  { href: '#problema', label: 'El problema' },
  { href: '#funciones', label: 'Funciones' },
  { href: '#planes', label: 'Planes' },
  { href: '#nosotros', label: 'Quiénes somos' },
  { href: '#faq', label: 'Preguntas' },
] as const;

export type PainIcon = 'clock' | 'phone' | 'chat' | 'sheet';

export const PAINS: { icon: PainIcon; title: string; text: string }[] = [
  { icon: 'clock', title: 'Te enterás tarde de las llegadas tarde', text: 'El puesto queda vacío y lo sabés cuando se queja el cliente.' },
  { icon: 'phone', title: 'Llamás sede por sede', text: 'Para saber quién está, quién no y quién "ya llega".' },
  { icon: 'chat', title: 'Turnos por WhatsApp, uno por uno', text: 'Y aun así alguien pregunta "¿qué turno tenía yo?".' },
  { icon: 'sheet', title: 'Una pila de Excels a fin de mes', text: 'Para reconstruir quién faltó y cuántas horas trabajó cada uno.' },
];

export const FEATURES: { before: string; title: string; text: string }[] = [
  { before: 'Llamar para ver si llegó', title: 'Fichada con GPS o QR', text: 'El empleado ficha desde su celular al llegar a la sede. Si está fuera de la zona, queda marcado.' },
  { before: 'Enterarte tarde', title: 'Alertas automáticas', text: 'Si alguien no fichó o un puesto quedó sin cubrir, te llega un aviso al celular y podés reasignar el turno.' },
  { before: 'Grupos de WhatsApp', title: 'Turnos claros para todos', text: 'Armás quién cubre qué puesto y cuándo. Cada empleado ve su turno, sin mensajes uno por uno.' },
  { before: 'Pilas de Excel', title: 'Asistencia y horas registradas', text: 'Cada fichada queda guardada: quién vino, quién faltó y cuánto trabajó.' },
  { before: '"Confiá, hice la ronda"', title: 'Tareas con foto y checklist', text: 'Rondas, formularios y listas de verificación con evidencia, durante el turno.' },
  { before: 'Adivinar qué pasa', title: 'Torre de Control en vivo', text: 'El estado de cada sede en una pantalla, actualizado en tiempo real.' },
];

export const STEPS: { title: string; text: string }[] = [
  { title: 'Cargás tus sedes', text: 'Con su ubicación y sus puestos.' },
  { title: 'Invitás a tu equipo', text: 'Cada empleado recibe un enlace y crea su acceso.' },
  { title: 'Armás los turnos', text: 'Y desde ahí, ellos fichan y vos lo ves todo.' },
];

export const PLANS: { name: string; tagline: string; price: string; features: string[]; featured: boolean }[] = [
  {
    name: 'Basic',
    tagline: 'Para ordenar la asistencia.',
    price: '$50.000',
    features: ['Sedes y puestos', 'Empleados con invitación', 'Turnos', 'Fichadas con GPS o QR y asistencia'],
    featured: false,
  },
  {
    name: 'Pro',
    tagline: 'Para supervisar todo en vivo.',
    price: '$100.000',
    features: [
      'Todo lo de Basic',
      'Tareas con formularios, fotos y checklists',
      'Alertas automáticas de tardanzas y puestos sin cubrir',
      'Torre de Control en vivo',
    ],
    featured: true,
  },
];

// TODO(landing): photo of Angela in `public/landing/team/`.
export const TEAM: { name: string; photo?: string }[] = [
  { name: 'Josué Aquino', photo: '/landing/team/josue-aquino.jpg' },
  { name: 'Angela' },
  { name: 'Matías Robles', photo: '/landing/team/matias-robles.jpg' },
];

export const ABOUT_TEXT =
  'TeamWorkFlow nació con la idea de solucionar problemas cotidianos a las empresas, pensando en convertirse en la mejor de la industria.';

export const FAQ: { q: string; a: string }[] = [
  { q: '¿Qué pasa si un empleado ficha fuera de la sede?', a: 'La fichada se acepta igual, pero queda marcada para que la revises.' },
  { q: '¿Cómo se suman los empleados?', a: 'Los das de alta y cada uno recibe un enlace de invitación para crear su acceso.' },
  { q: '¿Qué pasa cuando terminan los 14 días?', a: 'Elegís Basic o Pro y se factura mes a mes. Pagás por Mercado Pago o transferencia.' },
  { q: '¿Sirve para seguridad, limpieza u otros rubros?', a: 'Sí: está pensada para cualquier empresa con personal repartido en varias sedes.' },
];
