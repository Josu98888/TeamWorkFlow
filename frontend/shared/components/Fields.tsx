import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Button } from './Button';

const CONTROL =
  'w-full rounded-lg border border-line bg-page px-3 py-2 text-sm text-body outline-none focus-visible:outline-2 focus-visible:outline-brand-medium';

function Label({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-subtitle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
};

export function TextField({ label, hint, onChange, className = '', ...rest }: TextFieldProps) {
  return (
    <Label label={label} hint={hint}>
      <input className={`${CONTROL} ${className}`} onChange={(event) => onChange(event.target.value)} {...rest} />
    </Label>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: string;
  hint?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
};

export function SelectField({ label, hint, options, onChange, ...rest }: SelectFieldProps) {
  return (
    <Label label={label} hint={hint}>
      <select className={CONTROL} onChange={(event) => onChange(event.target.value)} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Label>
  );
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-body">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** Error line + submit/cancel row shared by every form. */
export function FormFooter({ error, pending, submitLabel, onCancel }: { error: string | null; pending: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="pt-2">
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Guardando...' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Parses a comma separated list into trimmed non-empty unique items. */
export const parseList = (text: string): string[] => [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
