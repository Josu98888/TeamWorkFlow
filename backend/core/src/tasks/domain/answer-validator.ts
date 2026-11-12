import {
  AnswerTooOldException,
  QrMismatchException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import type { FormFieldDefinition } from './form-validator';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidateAnswersOptions {
  submittedAnswers: Record<string, unknown>;
  formFields: FormFieldDefinition[];
  expectedQr?: string | null;
  deviceTime: Date;
  now?: Date;
}

export function validateTaskAnswers({
  submittedAnswers,
  formFields,
  expectedQr,
  deviceTime,
  now = new Date(),
}: ValidateAnswersOptions): Record<string, unknown> {
  const ageMs = now.getTime() - deviceTime.getTime();
  if (ageMs > TWENTY_FOUR_HOURS_MS) {
    throw new AnswerTooOldException();
  }

  const errors: { field: string; constraints: string[] }[] = [];
  const sanitizedAnswers: Record<string, unknown> = {};

  for (const field of formFields) {
    const value = submittedAnswers[field.key];
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (field.required && isMissing) {
      errors.push({
        field: field.key,
        constraints: [`Field ${field.label} is required`],
      });
      continue;
    }

    if (isMissing) {
      continue;
    }

    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string') {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be a string`],
          });
        } else {
          sanitizedAnswers[field.key] = value.trim();
        }
        break;
      }

      case 'number': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be a number`],
          });
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push({
              field: field.key,
              constraints: [`Field ${field.label} must be at least ${field.min}`],
            });
          }
          if (field.max !== undefined && value > field.max) {
            errors.push({
              field: field.key,
              constraints: [`Field ${field.label} cannot exceed ${field.max}`],
            });
          }
          sanitizedAnswers[field.key] = value;
        }
        break;
      }

      case 'yes_no': {
        if (typeof value !== 'boolean') {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be a boolean`],
          });
        } else {
          sanitizedAnswers[field.key] = value;
        }
        break;
      }

      case 'select': {
        if (typeof value !== 'string' || !field.options?.includes(value)) {
          errors.push({
            field: field.key,
            constraints: [
              `Field ${field.label} must be one of: ${(field.options ?? []).join(', ')}`,
            ],
          });
        } else {
          sanitizedAnswers[field.key] = value;
        }
        break;
      }

      case 'checklist': {
        if (!Array.isArray(value)) {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be an array of selected options`],
          });
        } else {
          const invalidOptions = value.filter(
            (v) => typeof v !== 'string' || !field.options?.includes(v),
          );
          if (invalidOptions.length > 0) {
            errors.push({
              field: field.key,
              constraints: [
                `Invalid options selected for ${field.label}: ${invalidOptions.join(', ')}`,
              ],
            });
          } else {
            sanitizedAnswers[field.key] = value;
          }
        }
        break;
      }

      case 'photo': {
        if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be a valid media UUID`],
          });
        } else {
          sanitizedAnswers[field.key] = value;
        }
        break;
      }

      case 'qr': {
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push({
            field: field.key,
            constraints: [`Field ${field.label} must be a non-empty QR code string`],
          });
        } else {
          const trimmed = value.trim();
          if (expectedQr && trimmed !== expectedQr) {
            throw new QrMismatchException();
          }
          sanitizedAnswers[field.key] = trimmed;
        }
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationException(errors);
  }

  return sanitizedAnswers;
}
