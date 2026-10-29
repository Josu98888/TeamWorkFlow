'use client';

import { useState } from 'react';
import { organizationApi } from '@/features/organization';
import { useResource } from '@/shared/hooks/useResource';
import { Button, FilterChip } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { fullName, formatPercent } from '@/shared/lib/format';
import { telemetryApi } from '../api';
import type { Alert } from '../types';
import { AlertItem } from './AlertItem';
import { SiteStatusRow } from './SiteStatusRow';

const ALERT_FILTERS = ['active', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
type AlertFilter = (typeof ALERT_FILTERS)[number];

const FILTER_LABELS = {
  active: 'Activas',
  OPEN: 'Abiertas',
  ACKNOWLEDGED: 'Reconocidas',
  RESOLVED: 'Resueltas',
} as const satisfies Record<AlertFilter, string>;

const matchesFilter = (alert: Alert, filter: AlertFilter) =>
  filter === 'active' ? alert.status !== 'RESOLVED' : alert.status === filter;

export function TowerView() {
  const snapshot = useResource(telemetryApi.getTowerSnapshot);
  const alertsPage = useResource(telemetryApi.listAlerts);
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);

  // Local state needed: acknowledge / resolve results are kept here until the live feed (P5) replaces them.
  const [overrides, setOverrides] = useState<Record<string, Alert>>({});
  const [busyIds, setBusyIds] = useState<readonly string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>('active');
  const [siteFilter, setSiteFilter] = useState<string | null>(null);

  const header = (
    <PageHeader
      title="Torre de Control"
      description="Presencia del personal por sede y alertas operativas del turno en curso."
    />
  );

  const error = snapshot.error ?? alertsPage.error ?? sites.error ?? employees.error;
  if (error) {
    return (
      <>
        {header}
        <ErrorState
          message="No pudimos cargar la Torre de Control."
          onRetry={() => {
            snapshot.reload();
            alertsPage.reload();
            sites.reload();
            employees.reload();
          }}
        />
      </>
    );
  }

  if (!snapshot.data || !alertsPage.data || !sites.data || !employees.data) {
    return (
      <>
        {header}
        <LoadingState rows={2} />
      </>
    );
  }

  const alerts = alertsPage.data.items.map((alert) => overrides[alert.id] ?? alert);
  const siteNames = new Map(sites.data.items.map((site) => [site.id, site.name]));
  const employeeNames = new Map(employees.data.items.map((employee) => [employee.id, fullName(employee)]));

  const expected = snapshot.data.items.reduce((total, item) => total + item.expected, 0);
  const present = snapshot.data.items.reduce((total, item) => total + item.present, 0);
  const countByStatus = (status: Alert['status']) => alerts.filter((alert) => alert.status === status).length;
  const activeAlertsBySite = (siteId: string) =>
    alerts.filter((alert) => alert.siteId === siteId && alert.status !== 'RESOLVED').length;

  const visibleAlerts = alerts
    .filter((alert) => matchesFilter(alert, filter) && (!siteFilter || alert.siteId === siteFilter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const runAction = async (alertId: string, action: (id: string) => Promise<Alert>) => {
    setActionError(null);
    setBusyIds((ids) => [...ids, alertId]);
    try {
      const updated = await action(alertId);
      setOverrides((current) => ({ ...current, [alertId]: updated }));
    } catch {
      setActionError('No pudimos actualizar la alerta. Intentá de nuevo.');
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== alertId));
    }
  };

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile
          label="Presentes ahora"
          value={`${present}/${expected}`}
          hint="Personal que fichó entrada"
          tone={present < expected ? 'warning' : 'success'}
        />
        <KpiTile
          label="Cobertura"
          value={formatPercent(expected === 0 ? 1 : present / expected)}
          hint="Presentes sobre esperados"
          tone={present < expected ? 'warning' : 'success'}
        />
        <KpiTile
          label="Alertas abiertas"
          value={countByStatus('OPEN')}
          hint="Esperan reconocimiento"
          tone={countByStatus('OPEN') > 0 ? 'danger' : 'success'}
        />
        <KpiTile label="Reconocidas" value={countByStatus('ACKNOWLEDGED')} hint="En seguimiento" tone="process" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section aria-label="Estado del personal por sede" className="lg:col-span-2">
          <Card flush>
            <div className="px-5 pt-5">
              <SectionLabel
                action={
                  siteFilter ? (
                    <Button variant="ghost" onClick={() => setSiteFilter(null)}>
                      Ver todas
                    </Button>
                  ) : undefined
                }
              >
                Personal por sede
              </SectionLabel>
            </div>
            <ul className="divide-y divide-line">
              {snapshot.data.items.map((item) => (
                <SiteStatusRow
                  key={item.siteId}
                  name={siteNames.get(item.siteId) ?? 'Sede'}
                  expected={item.expected}
                  present={item.present}
                  openAlerts={activeAlertsBySite(item.siteId)}
                  selected={siteFilter === item.siteId}
                  onSelect={() => setSiteFilter((current) => (current === item.siteId ? null : item.siteId))}
                />
              ))}
            </ul>
          </Card>
        </section>

        <section aria-label="Alertas" className="lg:col-span-3">
          <Card flush>
            <div className="px-5 pt-5">
              <SectionLabel>
                Alertas{siteFilter ? ` · ${siteNames.get(siteFilter) ?? 'Sede'}` : ''}
              </SectionLabel>
              <div className="flex flex-wrap gap-2 pb-4">
                {ALERT_FILTERS.map((option) => (
                  <FilterChip
                    key={option}
                    label={FILTER_LABELS[option]}
                    count={alerts.filter((alert) => matchesFilter(alert, option)).length}
                    active={filter === option}
                    onSelect={() => setFilter(option)}
                  />
                ))}
              </div>
              {actionError && (
                <p role="alert" className="pb-3 text-xs font-semibold text-danger">
                  {actionError}
                </p>
              )}
            </div>

            {visibleAlerts.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState title="No hay alertas en esta vista" description="Probá con otro filtro o sede." />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {visibleAlerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    siteName={siteNames.get(alert.siteId) ?? 'Sede'}
                    employeeName={alert.employeeId ? (employeeNames.get(alert.employeeId) ?? null) : null}
                    isBusy={busyIds.includes(alert.id)}
                    onAcknowledge={(id) => runAction(id, telemetryApi.acknowledgeAlert)}
                    onResolve={(id) => runAction(id, (alertId) => telemetryApi.resolveAlert(alertId))}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
