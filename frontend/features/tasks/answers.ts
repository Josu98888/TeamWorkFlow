import type { FormField } from './types';

/**
 * Values being edited, by field key. `number` is kept as the raw text typed (so "1." survives typing),
 * `yes_no` as boolean, `checklist` as string[], the rest as strings (`photo`: the media id).
 */
export type AnswerValues = Record<string, unknown>;

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** Mirrors `validateTaskAnswers` of core with Spanish copy; returns the first problem or null. */
export function validateAnswers(fields: readonly FormField[], values: AnswerValues): string | null {
  for (const field of fields) {
    const value = values[field.key];
    if (isEmpty(value)) {
      if (field.required) return `Completá "${field.label}".`;
      continue;
    }
    if (field.type === 'number') {
      const number = Number(value);
      if (Number.isNaN(number)) return `"${field.label}" debe ser un número.`;
      if (field.min !== undefined && number < field.min) return `"${field.label}" debe ser al menos ${field.min}.`;
      if (field.max !== undefined && number > field.max) return `"${field.label}" no puede superar ${field.max}.`;
    }
  }
  return null;
}

/** Wire answers: empty optional values are omitted and numbers are converted. */
export function buildAnswers(fields: readonly FormField[], values: AnswerValues): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (isEmpty(value)) continue;
    answers[field.key] = field.type === 'number' ? Number(value) : typeof value === 'string' ? value.trim() : value;
  }
  return answers;
}
