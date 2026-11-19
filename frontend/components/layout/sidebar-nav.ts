import type { IconName } from './SidebarIcons';

export type NavItem = { label: string; href: string; icon: IconName };
export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operación',
    items: [
      { label: 'Mi jornada', href: '/mi-jornada', icon: 'clock' },
      { label: 'Panel principal', href: '/', icon: 'home' },
      { label: 'Torre de Control', href: '/torre-control', icon: 'tower' },
      { label: 'Sedes y Geocercas', href: '/sedes', icon: 'pin' },
      { label: 'Tareas y Reportes', href: '/tareas', icon: 'tasks' },
      { label: 'Notificaciones', href: '/notificaciones', icon: 'bell' },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { label: 'Empleados', href: '/empleados', icon: 'users' },
      { label: 'Turnos', href: '/turnos', icon: 'calendar' },
      { label: 'Asistencia', href: '/asistencia', icon: 'attendance' },
      { label: 'Usuarios', href: '/usuarios', icon: 'shield' },
    ],
  },
  {
    title: 'Cuenta',
    items: [
      { label: 'Facturación', href: '/facturacion', icon: 'receipt' },
      { label: 'Facturación plataforma', href: '/plataforma/facturacion', icon: 'building' },
    ],
  },
];
