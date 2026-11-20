import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { formatRelative, formatTime } from '@/shared/lib/format';
import {
  ALERT_STATUS_LABELS,
  ALERT_STATUS_TONES,
  ALERT_TYPE_DESCRIPTIONS,
  ALERT_TYPE_LABELS,
  ALERT_TYPE_SEVERITY,
} from '../labels';
import type { Alert } from '../types';
import './tower.css';

type AlertItemProps = {
  alert: Alert;
  siteName: string;
  employeeName: string | null;
  isBusy: boolean;
  /** Arrived a moment ago: soft red border. */
  isFresh: boolean;
  onAcknowledge: (alertId: string) => void;
  onResolve: (alertId: string) => void;
  /** Centers the map on the site of this alert. */
  onShowOnMap: (siteId: string) => void;
};

/** One card of the alerts feed with its acknowledge / resolve / show-on-map actions. */
export function AlertItem({ alert, siteName, employeeName, isBusy, isFresh, onAcknowledge, onResolve, onShowOnMap }: AlertItemProps) {
  const title = ALERT_TYPE_LABELS[alert.type];
  const severity = alert.status === 'RESOLVED' ? 'done' : ALERT_TYPE_SEVERITY[alert.type];

  return (
    <li className="tw-alert" data-severity={severity} data-fresh={isFresh}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={ALERT_STATUS_TONES[alert.status]}>{ALERT_STATUS_LABELS[alert.status]}</Badge>
          <p className="text-sm font-semibold text-title">{title}</p>
        </div>
        <time dateTime={alert.createdAt} title={formatRelative(alert.createdAt)} className="shrink-0 text-xs text-muted">
          {formatTime(alert.createdAt)}
        </time>
      </div>
      <p className="mt-1 text-xs text-muted">{ALERT_TYPE_DESCRIPTIONS[alert.type]}</p>
      <p className="mt-1.5 text-xs text-body">
        <span className="font-semibold">{siteName}</span>
        {' · '}
        {employeeName ?? 'Sin empleado asignado'}
        {' · '}
        <span className="text-muted">{formatRelative(alert.createdAt)}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {alert.status === 'OPEN' && (
          <Button variant="primary" disabled={isBusy} aria-label={`Reconocer alerta: ${title}, ${siteName}`} onClick={() => onAcknowledge(alert.id)}>
            Reconocer
          </Button>
        )}
        {alert.status !== 'RESOLVED' && (
          <Button disabled={isBusy} aria-label={`Resolver alerta: ${title}, ${siteName}`} onClick={() => onResolve(alert.id)}>
            Resolver
          </Button>
        )}
        <Button variant="ghost" aria-label={`Ver en mapa: ${siteName}`} onClick={() => onShowOnMap(alert.siteId)}>
          Ver en mapa
        </Button>
      </div>
    </li>
  );
}
