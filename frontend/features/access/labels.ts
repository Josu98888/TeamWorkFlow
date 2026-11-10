import type { AssignableRole } from './types';

export const ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  employee: 'Empleado',
} as const satisfies Record<AssignableRole, string>;
