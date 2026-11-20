import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS = {
  primary: 'bg-brand text-white shadow-sm hover:opacity-90',
  secondary: 'border border-line bg-card text-body hover:bg-alt',
  ghost: 'text-link hover:bg-alt',
} as const satisfies Record<Variant, string>;

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

type FilterChipProps = {
  label: string;
  count?: number;
  active: boolean;
  onSelect: () => void;
};

/** Toggle chip for list filters. */
export function FilterChip({ label, count, active, onSelect }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${FOCUS} ${
        active ? 'border-brand bg-brand text-white' : 'border-line bg-card text-body hover:bg-alt'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-alt text-muted'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

type ButtonLinkProps = { href: string; variant?: Variant; className?: string; children: ReactNode };

/** Navigation link with the look of `Button` (page header and card actions). */
export function ButtonLink({ href, variant = 'secondary', className = '', children }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors ${FOCUS} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
