import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card } from './Card';
import { TONE_BAR, TONE_TEXT, type Tone } from './Badge';

type KpiTileProps = {
  label: string;
  value: string | number;
  /** Smaller trailing part of the value, e.g. "/48". */
  secondary?: string;
  hint?: string;
  tone?: Tone;
  href?: string;
  /** Icon shown in the 34px chip (see `KpiIcon`). */
  icon?: ReactNode;
  /** Text of the tone pill. Without it there is no pill and `tone` colors the value. */
  delta?: string;
  /** Small variant for secondary rows (detail pages): shorter, smaller value. */
  compact?: boolean;
};

const PILL_BG = {
  success: 'bg-success/12',
  warning: 'bg-warning/12',
  danger: 'bg-danger/12',
  info: 'bg-info/12',
  process: 'bg-process/12',
  neutral: 'bg-alt',
} as const satisfies Record<Tone, string>;

export function KpiTile({ label, value, secondary, hint, tone = 'neutral', href, icon, delta, compact = false }: KpiTileProps) {
  const valueColor = delta || tone === 'neutral' ? 'text-title' : TONE_TEXT[tone];

  const content = (
    <Card interactive={Boolean(href)} className={`flex h-full flex-col ${compact ? 'min-h-[88px] !p-4' : 'min-h-[150px] sm:min-h-[176px]'}`}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-chip text-chip-fg">
            {icon}
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-body">{label}</p>
        {href && (
          <span aria-hidden className="text-lg leading-none text-muted">
            ···
          </span>
        )}
      </div>
      <p className={`mt-auto font-bold tracking-tight ${compact ? 'text-2xl sm:text-3xl' : 'text-4xl'} ${valueColor}`}>
        {value}
        {secondary && <span className="ml-0.5 text-lg font-semibold text-muted">{secondary}</span>}
      </p>
      {delta ? (
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-body ${PILL_BG[tone]}`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_BAR[tone]}`} />
            {delta}
          </span>
          {hint && <span className="hidden text-xs text-muted sm:inline">{hint}</span>}
        </div>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
