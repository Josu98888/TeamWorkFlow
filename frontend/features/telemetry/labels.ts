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

/** Spanish copy for the backend error codes of `POST /clock-events` (telemetry `app.exceptions.ts`). */
export const CLOCK_ERROR_MESSAGES: Record<string, string> = {
  invalid_qr: 'El código QR no corresponde a la sede del turno. Escaneá el QR impreso en tu sede.',
  no_matching_shift: 'No encontramos un turno para esta fichada. Revisá el turno elegido y el tipo de fichada (para salir necesitás haber fichado la entrada).',
  clock_too_old: 'La fichada tiene más de 24 horas y ya no se puede registrar. Pedile una corrección a tu supervisor.',
  validation_error: 'Faltan datos: necesitamos tu ubicación o el código QR.',
  forbidden: 'No tenés permiso para fichar con esta cuenta (no hay un legajo de empleado asociado).',
  rate_limited: 'Demasiados intentos. Esperá un momento y volvé a probar.',
  tenant_suspended: 'La cuenta de la organización está suspendida.',
  tenant_cancelled: 'La cuenta de la organización fue cancelada.',
  upstream_timeout: 'El servidor tardó demasiado en responder. Probá de nuevo.',
  upstream_unavailable: 'El servicio no está disponible por el momento. Probá de nuevo en unos minutos.',
};
