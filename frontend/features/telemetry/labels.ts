import type { Tone } from '@/shared/components/Badge';
import type { AlertStatus, AlertType } from './types';

export const ALERT_TYPE_LABELS = {
  LATE: 'Llegada tarde',
  UNCOVERED_POST: 'Puesto sin cubrir',
  OUT_OF_GEOFENCE: 'Fuera de geocerca',
  MISSING_CLOCK_OUT: 'Salida sin fichar',
} as const satisfies Record<AlertType, string>;

export const ALERT_TYPE_DESCRIPTIONS = {
  LATE: 'No fichó la entrada del turno en curso.',
  UNCOVERED_POST: 'El turno en curso no tiene a nadie asignado.',
  OUT_OF_GEOFENCE: 'Fichó fuera del radio de la sede.',
  MISSING_CLOCK_OUT: 'El turno terminó y no registró la salida.',
} as const satisfies Record<AlertType, string>;

export const ALERT_STATUS_LABELS = {
  OPEN: 'Abierta',
  ACKNOWLEDGED: 'Reconocida',
  RESOLVED: 'Resuelta',
} as const satisfies Record<AlertStatus, string>;

export const ALERT_STATUS_TONES = {
  OPEN: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
} as const satisfies Record<AlertStatus, Tone>;
