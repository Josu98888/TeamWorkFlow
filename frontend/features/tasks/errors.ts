import { ApiError } from '@/shared/lib/http';

/** Spanish copy for the backend error codes of the tasks module (`backend/core/src/tasks/AGENTS.md`, "Errors"). */
export const TASK_ERROR_MESSAGES: Record<string, string> = {
  form_not_found: 'No encontramos el formulario.',
  task_not_found: 'No encontramos la tarea. Puede que ya no exista.',
  media_not_found: 'No encontramos la foto subida. Volvé a cargarla.',
  form_not_published: 'El formulario elegido no tiene una versión publicada.',
  task_not_open: 'La tarea ya no está abierta: se completó, venció o fue cancelada.',
  task_already_claimed: 'Otra persona ya reclamó esta tarea.',
  no_shift_in_progress: 'Necesitás tener un turno en curso en este puesto para reclamar o responder la tarea.',
  qr_mismatch: 'El código QR no coincide con el que espera la tarea. Escaneá el QR correcto.',
  answer_too_old: 'La respuesta tiene más de 24 horas y ya no se puede enviar.',
  media_too_large: 'La foto supera el máximo de 10 MB. Elegí una más liviana.',
  media_type_not_allowed: 'Formato de foto no permitido. Usá JPG, PNG o WebP.',
  media_not_uploaded: 'La foto no terminó de subirse. Volvé a cargarla y reintentá.',
  validation_error: 'Algún dato no es válido. Revisá los campos e intentá de nuevo.',
};

/** Message for any failure of a tasks call: known backend code first, then the API message, then `fallback`. */
export function taskErrorMessage(cause: unknown, fallback = 'No se pudo completar la acción.'): string {
  if (cause instanceof ApiError) return (cause.code && TASK_ERROR_MESSAGES[cause.code]) || cause.message;
  return cause instanceof Error ? cause.message : fallback;
}
