import type { Tone } from '@/shared/components/Badge';
import type { FormFieldType, TaskKind, TaskStatus } from './types';

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

export const FORM_FIELD_TYPE_LABELS = {
  text: 'Texto',
  number: 'Número',
  yes_no: 'Sí / No',
  select: 'Selección única',
  checklist: 'Lista de verificación',
  photo: 'Foto',
  qr: 'Código QR',
} as const satisfies Record<FormFieldType, string>;
