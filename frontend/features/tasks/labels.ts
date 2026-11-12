import type { Tone } from '@/shared/components/Badge';
import type { TaskKind, TaskStatus } from './types';

export const TASK_STATUS_LABELS = {
  PENDING: 'Pendiente',
  COMPLETED: 'Completada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
} as const satisfies Record<TaskStatus, string>;

export const TASK_STATUS_TONES = {
  PENDING: 'info',
  COMPLETED: 'success',
  EXPIRED: 'danger',
  CANCELLED: 'neutral',
} as const satisfies Record<TaskStatus, Tone>;

export const TASK_KIND_LABELS = {
  SINGLE: 'Única',
  PER_SHIFT: 'Por turno',
} as const satisfies Record<TaskKind, string>;
