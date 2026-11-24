import { formatPercent } from '@/shared/lib/format';
import type { TowerSiteState } from './TowerMap';

export type SiteOperationRow = {
  siteId: string;
  name: string;
  present: number;
  expected: number;
  activeAlerts: number;
  openAlerts: number;
  state: TowerSiteState;
};

type SiteOperationsTableProps = {
  rows: readonly SiteOperationRow[];
  selectedSiteId: string | null;
  onSelectSite: (siteId: string) => void;
  onLocateSite: (siteId: string) => void;
};

const STATE_META = {
  ok: {
    label: 'Operativa',
    dot: 'bg-success',
    bar: 'bg-success',
    text: 'text-muted',
  },
  warn: {
    label: 'Dotación incompleta',
    dot: 'bg-warning',
    bar: 'bg-warning',
    text: 'text-warning',
  },
  danger: {
    label: 'Con incidente',
    dot: 'bg-danger',
    bar: 'bg-danger',
    text: 'text-danger',
  },
} as const satisfies Record<TowerSiteState, { label: string; dot: string; bar: string; text: string }>;

/** Compact 4-column operational table per site: fits cleanly without horizontal scrolling. */
export function SiteOperationsTable({
  rows,
  selectedSiteId,
  onSelectSite,
  onLocateSite,
}: SiteOperationsTableProps) {
  return (
    <div className="border-t border-line">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-alt/60 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <th scope="col" className="w-[42%] px-4 py-2.5">
              Sede / Estado
            </th>
            <th scope="col" className="w-[26%] px-2 py-2.5">
              Dotación
            </th>
            <th scope="col" className="w-[16%] px-2 py-2.5 text-right">
              Alertas
            </th>
            <th scope="col" className="w-[16%] px-4 py-2.5 text-right">
              Mapa
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const meta = STATE_META[row.state];
            const ratio = row.expected === 0 ? 1 : Math.min(1, Math.max(0, row.present / row.expected));
            const isSelected = selectedSiteId === row.siteId;

            return (
              <tr
                key={row.siteId}
                aria-selected={isSelected}
                className={`transition-colors hover:bg-alt/50 ${
                  isSelected ? 'bg-brand-medium/8' : ''
                }`}
              >
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => onSelectSite(row.siteId)}
                    className="group flex w-full items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-brand-medium"
                  >
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-title group-hover:underline">
                        {row.name}
                      </span>
                      <span className={`block truncate text-[11px] font-medium ${meta.text}`}>
                        {meta.label}
                      </span>
                    </span>
                  </button>
                </td>

                <td className="px-2 py-2.5">
                  <div className="flex items-baseline justify-between gap-1 font-mono tabular-nums">
                    <span>
                      <strong className="font-semibold text-title">{row.present}</strong>
                      <span className="text-muted">/{row.expected}</span>
                    </span>
                    <span className="text-[11px] text-muted">{formatPercent(ratio)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-alt">
                    <div
                      className={`h-full rounded-full ${meta.bar}`}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                </td>

                <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                  {row.activeAlerts > 0 ? (
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        row.openAlerts > 0
                          ? 'bg-danger/15 text-danger'
                          : 'bg-process/15 text-body'
                      }`}
                    >
                      {row.openAlerts > 0 ? `${row.openAlerts} ab.` : `${row.activeAlerts} seg.`}
                    </span>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                </td>

                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onLocateSite(row.siteId)}
                    className="rounded-md border border-line bg-card px-2.5 py-1 text-[11px] font-semibold text-body transition-colors hover:border-brand-medium hover:text-title focus-visible:outline-2 focus-visible:outline-brand-medium"
                  >
                    Ubicar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}