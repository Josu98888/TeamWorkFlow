'use client';

import { useState, type ChangeEvent } from 'react';
import { QrScanner, canScanQr } from '@/features/telemetry';
import { Button } from '@/shared/components/Button';
import { CheckField, SelectField, TextField } from '@/shared/components/Fields';
import { uploadPhoto } from '../media';
import type { FormField } from '../types';

type FieldInputProps = {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Photo fields report while a file is being uploaded so the form can block the submit. */
  onBusyChange: (busy: boolean) => void;
};

const label = (field: FormField) => (field.required ? `${field.label} *` : field.label);

/** Input for one field of a form version, by field type. */
export function FieldInput({ field, value, onChange, onBusyChange }: FieldInputProps) {
  switch (field.type) {
    case 'text':
      return <TextField label={label(field)} value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'number':
      return (
        <TextField
          label={label(field)}
          type="number"
          inputMode="decimal"
          step="any"
          min={field.min}
          max={field.max}
          hint={field.min !== undefined || field.max !== undefined ? `Entre ${field.min ?? '-∞'} y ${field.max ?? '∞'}` : undefined}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'yes_no':
      return (
        <SelectField
          label={label(field)}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(next) => onChange(next === '' ? undefined : next === 'yes')}
          options={[
            { value: '', label: 'Elegí una opción' },
            { value: 'yes', label: 'Sí' },
            { value: 'no', label: 'No' },
          ]}
        />
      );
    case 'select':
      return (
        <SelectField
          label={label(field)}
          value={typeof value === 'string' ? value : ''}
          onChange={(next) => onChange(next === '' ? undefined : next)}
          options={[{ value: '', label: 'Elegí una opción' }, ...(field.options ?? []).map((option) => ({ value: option, label: option }))]}
        />
      );
    case 'checklist': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold text-subtitle">{label(field)}</legend>
          {(field.options ?? []).map((option) => (
            <CheckField
              key={option}
              label={option}
              checked={selected.includes(option)}
              onChange={(checked) => onChange(checked ? [...selected, option] : selected.filter((item) => item !== option))}
            />
          ))}
        </fieldset>
      );
    }
    case 'photo':
      return <PhotoInput field={field} value={value} onChange={onChange} onBusyChange={onBusyChange} />;
    case 'qr':
      return <QrInput field={field} value={value} onChange={onChange} />;
  }
}

type PhotoState = { phase: 'uploading' | 'error'; name: string; error?: string } | null;

function PhotoInput({ field, value, onChange, onBusyChange }: FieldInputProps) {
  const [state, setState] = useState<PhotoState>(null);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onChange(undefined);
    setState({ phase: 'uploading', name: file.name });
    onBusyChange(true);
    try {
      onChange(await uploadPhoto(file));
      setState(null);
    } catch (cause) {
      setState({ phase: 'error', name: file.name, error: cause instanceof Error ? cause.message : 'No se pudo subir la foto.' });
    } finally {
      onBusyChange(false);
    }
  };

  const uploaded = typeof value === 'string' && value !== '';

  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-subtitle">{label(field)}</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label={field.label}
        onChange={pick}
        className="block w-full text-xs text-body file:mr-3 file:cursor-pointer file:rounded-xl file:border file:border-line file:bg-card file:px-3.5 file:py-1.5 file:text-xs file:font-semibold file:text-body"
      />
      <p role="status" className="mt-1 text-[11px] text-muted">
        {state?.phase === 'uploading' && `Subiendo ${state.name}...`}
        {state?.phase === 'error' && <span className="text-danger">{state.error}</span>}
        {!state && uploaded && 'Foto subida.'}
        {!state && !uploaded && 'JPG, PNG o WebP, hasta 10 MB.'}
      </p>
    </div>
  );
}

function QrInput({ field, value, onChange }: Pick<FieldInputProps, 'field' | 'value' | 'onChange'>) {
  const [scanning, setScanning] = useState(false);

  if (scanning) {
    return (
      <QrScanner
        onDetected={(code) => {
          onChange(code);
          setScanning(false);
        }}
        onClose={() => setScanning(false)}
      />
    );
  }
  return (
    <div className="space-y-2">
      <TextField label={label(field)} value={typeof value === 'string' ? value : ''} onChange={onChange} autoComplete="off" />
      {canScanQr() && (
        <Button className="w-full py-2" onClick={() => setScanning(true)}>
          Escanear QR con la cámara
        </Button>
      )}
    </div>
  );
}
