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
