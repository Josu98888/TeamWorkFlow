import { Badge } from '@/shared/components/Badge';
import { ProgressBar } from '@/shared/components/ProgressBar';

type SiteStatusRowProps = {
  name: string;
  expected: number;
  present: number;
  openAlerts: number;
  selected: boolean;
  onSelect: () => void;
};

/** Staff presence of one site; selecting it filters the alerts feed. */
export function SiteStatusRow({ name, expected, present, openAlerts, selected, onSelect }: SiteStatusRowProps) {
  const covered = expected === 0 || present >= expected;

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Filtrar alertas de ${name}`}
        onClick={onSelect}
        className={`block w-full cursor-pointer px-5 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-medium ${
          selected ? 'bg-hover' : 'hover:bg-alt'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-title">{name}</p>
          {openAlerts > 0 ? (
            <Badge tone="danger">
              {openAlerts} {openAlerts === 1 ? 'alerta' : 'alertas'}
            </Badge>
          ) : (
            <Badge tone="success">Sin alertas</Badge>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex-1">
            <ProgressBar label={`Presentes en ${name}`} value={present} max={expected} tone={covered ? 'success' : 'warning'} />
          </div>
          <p className="shrink-0 text-xs font-semibold text-body">
            {present}/{expected} presentes
          </p>
        </div>
      </button>
    </li>
  );
}
