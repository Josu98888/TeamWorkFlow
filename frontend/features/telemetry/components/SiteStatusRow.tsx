import { Badge, type Tone } from '@/shared/components/Badge';
import { ProgressBar } from '@/shared/components/ProgressBar';
import type { TowerSiteState } from './TowerMap';

type SiteStatusRowProps = {
  name: string;
  expected: number;
  present: number;
  /** Alerts not resolved yet (open or acknowledged). */
  activeAlerts: number;
  state: TowerSiteState;
  selected: boolean;
  onSelect: () => void;
};

const STATE_TONE = { ok: 'success', warn: 'warning', danger: 'danger' } as const satisfies Record<TowerSiteState, Tone>;

/** Staff presence of one site; selecting it filters the alerts feed and the map. */
export function SiteStatusRow({ name, expected, present, activeAlerts, state, selected, onSelect }: SiteStatusRowProps) {
  const missing = Math.max(0, expected - present);
  const badge = state === 'danger' ? 'Alerta' : state === 'warn' ? `Falta ${missing}` : 'Completa';
  const detail = activeAlerts > 0 ? `${activeAlerts} ${activeAlerts === 1 ? 'alerta activa' : 'alertas activas'}` : 'Sin alertas';

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Filtrar por ${name}`}
        onClick={onSelect}
        className={`block w-full cursor-pointer px-5 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-medium ${
          selected ? 'bg-hover' : 'hover:bg-alt'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-title">{name}</p>
            <p className="text-xs text-muted">{detail}</p>
          </div>
          <p className="shrink-0 text-sm font-bold text-title">
            {present}/{expected}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1">
            <ProgressBar
              label={`Presentes en ${name}`}
              value={present}
              max={expected}
              tone={state === 'ok' ? 'done' : STATE_TONE[state]}
            />
          </div>
          <Badge tone={STATE_TONE[state]}>{badge}</Badge>
        </div>
      </button>
    </li>
  );
}
