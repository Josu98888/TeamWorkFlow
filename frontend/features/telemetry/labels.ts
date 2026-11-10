import type { Tone } from '@/shared/components/Badge';
import type { AlertStatus, AlertType, ClockEventMethod, ClockEventType, WorkdayStatus } from './types';

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

export const CLOCK_EVENT_TYPE_LABELS = {
  IN: 'Entrada',
  OUT: 'Salida',
  BREAK_START: 'Inicio de descanso',
  BREAK_END: 'Fin de descanso',
} as const satisfies Record<ClockEventType, string>;

export const CLOCK_EVENT_METHOD_LABELS = {
  GPS: 'GPS',
  QR: 'QR',
  MANUAL: 'Manual',
} as const satisfies Record<ClockEventMethod, string>;

export const WORKDAY_STATUS_LABELS = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  MISSING_CLOCK_OUT: 'Sin salida',
} as const satisfies Record<WorkdayStatus, string>;

export const WORKDAY_STATUS_TONES = {
  OPEN: 'info',
  CLOSED: 'success',
  MISSING_CLOCK_OUT: 'danger',
} as const satisfies Record<WorkdayStatus, Tone>;
