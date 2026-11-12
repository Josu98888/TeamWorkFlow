import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { formatRelative } from '@/shared/lib/format';
import { ALERT_STATUS_LABELS, ALERT_STATUS_TONES, ALERT_TYPE_DESCRIPTIONS, ALERT_TYPE_LABELS } from '../labels';
import type { Alert } from '../types';

type AlertItemProps = {
  alert: Alert;
  siteName: string;
  employeeName: string | null;
  isBusy: boolean;
  onAcknowledge: (alertId: string) => void;
  onResolve: (alertId: string) => void;
};

/** One row of the alerts feed with its acknowledge / resolve actions. */
export function AlertItem({ alert, siteName, employeeName, isBusy, onAcknowledge, onResolve }: AlertItemProps) {
  const title = ALERT_TYPE_LABELS[alert.type];

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-title">{title}</p>
          <Badge tone={ALERT_STATUS_TONES[alert.status]}>{ALERT_STATUS_LABELS[alert.status]}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted">{ALERT_TYPE_DESCRIPTIONS[alert.type]}</p>
        <p className="mt-1.5 text-xs text-body">
          <span className="font-semibold">{siteName}</span>
          {' · '}
          {employeeName ?? 'Sin empleado asignado'}
          {' · '}
          <span className="text-muted">{formatRelative(alert.createdAt)}</span>
        </p>
      </div>

      {alert.status !== 'RESOLVED' && (
        <div className="flex shrink-0 gap-2">
          {alert.status === 'OPEN' && (
            <Button disabled={isBusy} aria-label={`Reconocer alerta: ${title}, ${siteName}`} onClick={() => onAcknowledge(alert.id)}>
              Reconocer
            </Button>
          )}
          <Button
            variant="primary"
            disabled={isBusy}
            aria-label={`Resolver alerta: ${title}, ${siteName}`}
            onClick={() => onResolve(alert.id)}
          >
            Resolver
          </Button>
        </div>
      )}
    </li>
  );
}
