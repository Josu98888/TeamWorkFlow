import type { FormField, FormFieldType } from './types';

/** Editable copy of a `FormField` used by the builder: numbers and options are kept as raw text while typing. */
export type DraftField = {
  /** Local identity (React key); never sent to the backend. */
  uid: string;
  key: string;
  /** True once the user typed the key, so a later label change no longer overwrites it. */
  keyTouched: boolean;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** One option per line. */
  optionsText: string;
  min: string;
  max: string;
};

export const hasOptions = (type: FormFieldType) => type === 'select' || type === 'checklist';

/** "Estado del extintor" -> "estado_del_extintor". */
export function slugifyKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function newDraftField(): DraftField {
  return { uid: crypto.randomUUID(), key: '', keyTouched: false, label: '', type: 'text', required: false, optionsText: '', min: '', max: '' };
}

export function toDraftField(field: FormField): DraftField {
  return {
    uid: crypto.randomUUID(),
    key: field.key,
    keyTouched: true,
    label: field.label,
    type: field.type,
    required: field.required,
    optionsText: (field.options ?? []).join('\n'),
    min: field.min === undefined ? '' : String(field.min),
    max: field.max === undefined ? '' : String(field.max),
  };
}

const parseOptions = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** Draft -> wire field, dropping the properties that do not apply to the type. */
export function toFormField(draft: DraftField): FormField {
  const field: FormField = { key: draft.key.trim(), label: draft.label.trim(), type: draft.type, required: draft.required };
  if (hasOptions(draft.type)) field.options = parseOptions(draft.optionsText);
  if (draft.type === 'number') {
    if (draft.min.trim() !== '') field.min = Number(draft.min);
    if (draft.max.trim() !== '') field.max = Number(draft.max);
  }
  return field;
}

/** Mirrors `validateFormFields` of core with Spanish copy; returns the first problem or null. */
export function validateDraft(name: string, drafts: readonly DraftField[]): string | null {
  if (!name.trim()) return 'El formulario necesita un nombre.';
  if (drafts.length === 0) return 'Agregá al menos un campo.';
  const keys = new Set<string>();
  for (const [index, draft] of drafts.entries()) {
    const where = `Campo ${index + 1}`;
    if (!draft.label.trim()) return `${where}: la etiqueta es obligatoria.`;
    const key = draft.key.trim();
    if (!key) return `${where}: la clave es obligatoria.`;
    if (keys.has(key)) return `${where}: la clave "${key}" está repetida.`;
    keys.add(key);
    if (hasOptions(draft.type) && parseOptions(draft.optionsText).length === 0) return `${where}: agregá al menos una opción.`;
    if (draft.type === 'number') {
      const min = draft.min.trim() === '' ? undefined : Number(draft.min);
      const max = draft.max.trim() === '' ? undefined : Number(draft.max);
      if (Number.isNaN(min) || Number.isNaN(max)) return `${where}: el mínimo y el máximo deben ser números.`;
      if (min !== undefined && max !== undefined && min > max) return `${where}: el mínimo no puede superar al máximo.`;
    }
  }
  return null;
}
