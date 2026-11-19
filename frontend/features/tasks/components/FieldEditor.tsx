'use client';

import { Button } from '@/shared/components/Button';
import { CheckField, SelectField, TextAreaField, TextField } from '@/shared/components/Fields';
import { hasOptions, slugifyKey, type DraftField } from '../form-fields';
import { FORM_FIELD_TYPE_LABELS } from '../labels';
import { FORM_FIELD_TYPES, type FormFieldType } from '../types';

const TYPE_OPTIONS = FORM_FIELD_TYPES.map((value) => ({ value, label: FORM_FIELD_TYPE_LABELS[value] }));

type FieldEditorProps = {
  field: DraftField;
  index: number;
  count: number;
  onChange: (next: DraftField) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

/** One field row of the form builder. */
export function FieldEditor({ field, index, count, onChange, onMove, onRemove }: FieldEditorProps) {
  const patch = (values: Partial<DraftField>) => onChange({ ...field, ...values });

  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-subtitle">Campo {index + 1}</p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Subir el campo ${index + 1}`}>
            Subir
          </Button>
          <Button variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Bajar el campo ${index + 1}`}>
            Bajar
          </Button>
          <Button variant="ghost" onClick={onRemove} aria-label={`Quitar el campo ${index + 1}`}>
            Quitar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Etiqueta"
          value={field.label}
          maxLength={120}
          onChange={(label) => patch({ label, ...(field.keyTouched ? {} : { key: slugifyKey(label) }) })}
        />
        <TextField
          label="Clave"
          hint="Identifica la respuesta; no se repite."
          value={field.key}
          maxLength={60}
          onChange={(key) => patch({ key, keyTouched: true })}
        />
        <SelectField label="Tipo" value={field.type} options={TYPE_OPTIONS} onChange={(type) => patch({ type: type as FormFieldType })} />
        <div className="flex items-end pb-2">
          <CheckField label="Obligatorio" checked={field.required} onChange={(required) => patch({ required })} />
        </div>
      </div>

      {hasOptions(field.type) && (
        <div className="mt-3">
          <TextAreaField label="Opciones" hint="Una por línea." value={field.optionsText} onChange={(optionsText) => patch({ optionsText })} />
        </div>
      )}

      {field.type === 'number' && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <TextField label="Mínimo (opcional)" type="number" value={field.min} onChange={(min) => patch({ min })} />
          <TextField label="Máximo (opcional)" type="number" value={field.max} onChange={(max) => patch({ max })} />
        </div>
      )}
    </li>
  );
}
