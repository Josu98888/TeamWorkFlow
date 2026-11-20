import type { ReactNode } from 'react';
import { TONE_BAR, TONE_TEXT, type Tone } from '@/shared/components/Badge';

export type TowerKpiItem = {
  id: string;
  label: string;
  value: string | number;
  secondary?: string;
  hint: string;
  badge?: string;
  tone: Tone;
  icon: ReactNode;
};

type TowerKpiStripProps = {
  items: readonly TowerKpiItem[];
};

const BADGE_BG = {
  success: 'bg-success/12',
  warning: 'bg-warning/12',
  danger: 'bg-danger/12',
  info: 'bg-info/12',
  process: 'bg-process/12',
  neutral: 'bg-alt',
} as const satisfies Record<Tone, string>;

/** Compact operational KPI strip for Control Tower: crisp borders, tabular numbers, and aligned baselines. */
export function TowerKpiStrip({ items }: TowerKpiStripProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const valueColor = item.badge || item.tone === 'neutral' ? 'text-title' : TONE_TEXT[item.tone];

        return (
          <article
            key={item.id}
            className="relative overflow-hidden rounded-2xl border border-line bg-card px-4 py-3.5 shadow-xs transition-colors"
          >
            {/* Accent bar along the left edge indicating operational state */}
            <span aria-hidden className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${TONE_BAR[item.tone]}`} />

            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted">{item.label}</p>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-chip text-chip-fg">
                {item.icon}
              </span>
            </div>

            <div className="mt-1.5 flex items-baseline gap-1.5">
              <p className={`text-2xl font-bold tracking-tight tabular-nums sm:text-[28px] ${valueColor}`}>
                {item.value}
              </p>
              {item.secondary && (
                <span className="text-sm font-semibold tabular-nums text-muted">{item.secondary}</span>
              )}
              {item.badge && (
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-body ${BADGE_BG[item.tone]}`}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_BAR[item.tone]}`} />
                  {item.badge}
                </span>
              )}
            </div>

            <p className="mt-1 truncate text-xs text-muted">{item.hint}</p>
          </article>
        );
      })}
    </div>
  );
}