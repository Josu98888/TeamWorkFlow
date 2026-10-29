import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'process' | 'neutral';

const TONE_STYLES = {
  success: { pill: 'bg-success/15', dot: 'bg-success' },
  warning: { pill: 'bg-warning/15', dot: 'bg-warning' },
  danger: { pill: 'bg-danger/15', dot: 'bg-danger' },
  info: { pill: 'bg-info/15', dot: 'bg-info' },
  process: { pill: 'bg-process/15', dot: 'bg-process' },
  neutral: { pill: 'bg-alt', dot: 'bg-disabled' },
} as const satisfies Record<Tone, { pill: string; dot: string }>;

/** Text-fill classes keyed by tone, for numbers that carry the tone color. */
export const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  process: 'text-process',
  neutral: 'text-muted',
} as const satisfies Record<Tone, string>;

export const TONE_BAR = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  process: 'bg-process',
  neutral: 'bg-disabled',
} as const satisfies Record<Tone, string>;

/** Status pill: tinted background, colored dot and body-colored text (reads in both themes). */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const styles = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-body ${styles.pill}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {children}
    </span>
  );
}
