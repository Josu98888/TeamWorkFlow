import { tasksApi } from './api';
import { TASK_ERROR_MESSAGES, taskErrorMessage } from './errors';

/** Limits enforced by core (`media.service.ts`); checked here first so the employee gets an immediate answer. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Tu navegador no permite procesar la foto en una conexión no segura.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads a photo in the three steps of core: request a presigned URL (`POST /media/uploads`), PUT the
 * bytes to it, and return the `mediaId` that goes into the `photo` answer. Rejects with Spanish copy.
 */
export async function uploadPhoto(file: File): Promise<string> {
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) throw new Error(TASK_ERROR_MESSAGES.media_type_not_allowed);
  if (file.size > MAX_PHOTO_BYTES) throw new Error(TASK_ERROR_MESSAGES.media_too_large);
  try {
    const sha256 = await sha256Hex(file);
    const upload = await tasksApi.requestUpload({
      mime: file.type,
      sizeBytes: file.size,
      sha256,
      takenAt: new Date(file.lastModified || Date.now()).toISOString(),
    });
    await tasksApi.uploadFile(upload.uploadUrl, file);
    return upload.mediaId;
  } catch (cause) {
    throw new Error(taskErrorMessage(cause, 'No se pudo subir la foto.'));
  }
}
