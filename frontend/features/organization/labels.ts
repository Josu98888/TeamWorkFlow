import type { Tone } from '@/shared/components/Badge';
import type { ShiftStatus } from './types';

export const SHIFT_STATUS_LABELS = {
  SCHEDULED: 'Programado',
  IN_PROGRESS: 'En curso',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
} as const satisfies Record<ShiftStatus, string>;

export const SHIFT_STATUS_TONES = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'success',
  FINISHED: 'neutral',
  CANCELLED: 'danger',
} as const satisfies Record<ShiftStatus, Tone>;

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7] as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};
