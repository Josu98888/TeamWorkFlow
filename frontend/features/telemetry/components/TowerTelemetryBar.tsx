import { KpiIcon } from '@/shared/components/KpiIcon';
import { formatPercent } from '@/shared/lib/format';

type TowerTelemetryBarProps = {
  present: number;
  expected: number;
  openAlerts: number;
  acknowledgedAlerts: number;
  resolvedAlerts: number;
  issuesCount: number;
  liveConnected: boolean;
  activeFilter: 'active' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  onlyIssues: boolean;
  onFilterAlerts: (filter: 'active' | 'OPEN' | 'ACKNOWLEDGED') => void;
  onToggleIssues: () => void;
};

/** Unified operational telemetry strip: coverage meter, SLA resolution rate, and interactive filter triggers. */
export function TowerTelemetryBar({
  present,
  expected,
  openAlerts,
  acknowledgedAlerts,
  resolvedAlerts,
  issuesCount,
  liveConnected,
  activeFilter,
  onlyIssues,
  onFilterAlerts,
  onToggleIssues,
}: TowerTelemetryBarProps) {
  const ratio = expected === 0 ? 1 : Math.min(1, Math.max(0, present / expected));
  const missing = Math.max(0, expected - present);
  const totalAlerts = openAlerts + acknowledgedAlerts + resolvedAlerts;
  const slaRatio = totalAlerts === 0 ? 1 : resolvedAlerts / totalAlerts;
  const coverageTone =
    ratio < 0.75 ? 'bg-danger' : ratio < 1 ? 'bg-warning' : 'bg-success';

  return (
    <section
      aria-label="Resumen operativo del turno"
      className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card lg:grid-cols-12 lg:divide-x lg:divide-y-0"
    >
      {/* Coverage & stream status (6 cols on desktop) */}
      <div className="flex flex-col justify-center gap-2 px-4 py-3 lg:col-span-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-chip text-chip-fg">
              <KpiIcon name="coverage" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Cobertura operativa
                </p>
                <span className="rounded bg-alt px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">
                  {liveConnected ? 'WS · LIVE' : 'SYNC · 15S'}
                </span>
              </div>
              <p className="text-xs text-muted">
                <strong className="font-mono font-semibold tabular-nums text-title">{present}</strong>/
                <span className="font-mono tabular-nums">{expected}</span> en puesto
                {missing > 0 ? (
                  <span className="ml-1.5 font-medium text-warning">· {missing} sin fichar</span>
                ) : (
                  <span className="ml-1.5 font-medium text-success">· Turno completo</span>
                )}
                <span className="ml-2 text-muted">
                  · Resolución: <strong className="font-mono text-body">{formatPercent(slaRatio)}</strong>
                </span>
              </p>
            </div>
          </div>

          <span className="font-mono text-2xl font-bold tracking-tight tabular-nums text-title">
            {formatPercent(ratio)}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Porcentaje de cobertura"
          className="h-1.5 w-full overflow-hidden rounded-full bg-alt"
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${coverageTone}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </div>

      {/* Interactive quick-filter triggers (6 cols split into 3 cells) */}
      <div className="grid grid-cols-3 divide-x divide-line lg:col-span-6">
        <button
          type="button"
          onClick={() => onFilterAlerts(activeFilter === 'OPEN' ? 'active' : 'OPEN')}
          aria-pressed={activeFilter === 'OPEN'}
          className={`group flex flex-col justify-between px-3.5 py-3 text-left transition-colors hover:bg-alt/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-medium ${
            activeFilter === 'OPEN' ? 'bg-danger/8' : ''
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Abiertas
            </span>
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${openAlerts > 0 ? 'bg-danger' : 'bg-success'}`}
            />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`font-mono text-2xl font-bold tabular-nums ${
                openAlerts > 0 ? 'text-danger' : 'text-title'
              }`}
            >
              {openAlerts}
            </span>
            <span className="text-[11px] font-medium text-muted group-hover:text-body">
              {activeFilter === 'OPEN' ? 'Activo' : 'Filtrar →'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onFilterAlerts(activeFilter === 'ACKNOWLEDGED' ? 'active' : 'ACKNOWLEDGED')}
          aria-pressed={activeFilter === 'ACKNOWLEDGED'}
          className={`group flex flex-col justify-between px-3.5 py-3 text-left transition-colors hover:bg-alt/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-medium ${
            activeFilter === 'ACKNOWLEDGED' ? 'bg-process/8' : ''
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              En curso
            </span>
            <span aria-hidden className="h-2 w-2 rounded-full bg-process" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-title">
              {acknowledgedAlerts}
            </span>
            <span className="text-[11px] font-medium text-muted group-hover:text-body">
              {activeFilter === 'ACKNOWLEDGED' ? 'Activo' : 'Filtrar →'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={onToggleIssues}
          aria-pressed={onlyIssues}
          className={`group flex flex-col justify-between px-3.5 py-3 text-left transition-colors hover:bg-alt/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-medium ${
            onlyIssues ? 'bg-warning/10' : ''
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Sedes c/ novedad
            </span>
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${issuesCount > 0 ? 'bg-warning' : 'bg-success'}`}
            />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`font-mono text-2xl font-bold tabular-nums ${
                issuesCount > 0 ? 'text-warning' : 'text-title'
              }`}
            >
              {issuesCount}
            </span>
            <span className="text-[11px] font-medium text-muted group-hover:text-body">
              {onlyIssues ? 'Filtrado' : 'Ver →'}
            </span>
          </div>
        </button>
      </div>
    </section>
  );
}