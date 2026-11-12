import { ValidationException } from '../../common/exceptions/app.exceptions';

export type FormFieldType =
  | 'text'
  | 'number'
  | 'yes_no'
  | 'select'
  | 'checklist'
  | 'photo'
  | 'qr';

export const ALLOWED_FIELD_TYPES: readonly FormFieldType[] = [
  'text',
  'number',
  'yes_no',
  'select',
  'checklist',
  'photo',
  'qr',
] as const;

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
}

export function validateFormFields(fields: unknown): FormFieldDefinition[] {
  if (!Array.isArray(fields)) {
    throw new ValidationException([
      { field: 'fields', constraints: ['Fields must be an array'] },
    ]);
  }

  if (fields.length === 0) {
    throw new ValidationException([
      { field: 'fields', constraints: ['Form must have at least one field'] },
    ]);
  }

  const seenKeys = new Set<string>();
  const validated: FormFieldDefinition[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as Partial<FormFieldDefinition>;
    const path = `fields[${i}]`;

    if (!field || typeof field !== 'object') {
      throw new ValidationException([
        { field: path, constraints: ['Field definition must be an object'] },
      ]);
    }

    if (!field.key || typeof field.key !== 'string' || field.key.trim() === '') {
      throw new ValidationException([
        { field: `${path}.key`, constraints: ['Field key is required and must be non-empty'] },
      ]);
    }

    if (seenKeys.has(field.key)) {
      throw new ValidationException([
        { field: `${path}.key`, constraints: [`Duplicate field key: ${field.key}`] },
      ]);
    }
    seenKeys.add(field.key);

    if (!field.label || typeof field.label !== 'string' || field.label.trim() === '') {
      throw new ValidationException([
        { field: `${path}.label`, constraints: ['Field label is required and must be non-empty'] },
      ]);
    }

    if (!field.type || !ALLOWED_FIELD_TYPES.includes(field.type as FormFieldType)) {
      throw new ValidationException([
        {
          field: `${path}.type`,
          constraints: [
            `Field type must be one of: ${ALLOWED_FIELD_TYPES.join(', ')}`,
          ],
        },
      ]);
    }

    if (typeof field.required !== 'boolean') {
      throw new ValidationException([
        { field: `${path}.required`, constraints: ['Field required flag must be a boolean'] },
      ]);
    }

    if (field.type === 'select' || field.type === 'checklist') {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        throw new ValidationException([
          {
            field: `${path}.options`,
            constraints: [`Field of type ${field.type} must define a non-empty options array`],
          },
        ]);
      }
      for (let j = 0; j < field.options.length; j++) {
        if (typeof field.options[j] !== 'string' || field.options[j].trim() === '') {
          throw new ValidationException([
            {
              field: `${path}.options[${j}]`,
              constraints: ['Option value must be a non-empty string'],
            },
          ]);
        }
      }
    }

    if (field.type === 'number') {
      if (field.min !== undefined && typeof field.min !== 'number') {
        throw new ValidationException([
          { field: `${path}.min`, constraints: ['min must be a number'] },
        ]);
      }
      if (field.max !== undefined && typeof field.max !== 'number') {
        throw new ValidationException([
          { field: `${path}.max`, constraints: ['max must be a number'] },
        ]);
      }
      if (
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      ) {
        throw new ValidationException([
          { field: `${path}.min`, constraints: ['min cannot be greater than max'] },
        ]);
      }
    }

    validated.push({
      key: field.key.trim(),
      label: field.label.trim(),
      type: field.type as FormFieldType,
      required: field.required,
      options: field.options,
      min: field.min,
      max: field.max,
    });
  }

  return validated;
}
