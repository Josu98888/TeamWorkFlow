'use client';

import { useRef, useState } from 'react';
import { organizationApi } from '@/features/organization';
import { useResource } from '@/shared/hooks/useResource';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { Segmented } from '@/shared/components/Segmented';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { fullName } from '@/shared/lib/format';
import { telemetryApi } from '../api';
import { useFreshAlertIds } from '../useFreshAlertIds';
import { useTowerLive } from '../useTowerLive';
import type { Alert } from '../types';
import { AlertItem } from './AlertItem';
import { SiteStatusRow } from './SiteStatusRow';
import { TowerMap, type TowerMapSite, type TowerSiteState } from './TowerMap';
import { TowerTelemetryBar } from './TowerTelemetryBar';
import './tower.css';

const ALERT_FILTERS = ['active', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
type AlertFilter = (typeof ALERT_FILTERS)[number];

const FILTER_LABELS = {
  active: 'Activas',
  OPEN: 'Abiertas',
  ACKNOWLEDGED: 'Reconocidas',
  RESOLVED: 'Resueltas',
} as const satisfies Record<AlertFilter, string>;

type SiteView = 'all' | 'issues';

const matchesFilter = (alert: Alert, filter: AlertFilter) =>
  filter === 'active' ? alert.status !== 'RESOLVED' : alert.status === filter;

export function TowerView() {
  const snapshot = useResource(telemetryApi.getTowerSnapshot);
  const alertsPage = useResource(telemetryApi.listAlerts);
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);
  const live = useTowerLive(
    () => {
      snapshot.reload();
      alertsPage.reload();
    },
    () => alertsPage.reload(),
  );

  // Local state needed: acknowledge / resolve results are kept here until the live feed (P5) replaces them.
  const [overrides, setOverrides] = useState<Record<string, Alert>>({});
  const [busyIds, setBusyIds] = useState<readonly string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>('active');
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [siteView, setSiteView] = useState<SiteView>('all');
  const [mapFocus, setMapFocus] = useState<{ siteId: string; nonce: number } | null>(null);
  const mapSection = useRef<HTMLElement | null>(null);
  const freshIds = useFreshAlertIds(alertsPage.data?.items);

  const header = (
    <PageHeader
      title="Torre de Control"
      description="Presencia del personal por sede y alertas operativas del turno en curso."
      badge={
        <span className="tw-live" data-live={live.connected}>
          {live.connected ? 'En vivo' : 'Actualiza cada 15 s'}
        </span>
      }
      actions={
        sites.data && sites.data.items.length > 1 ? (
          <select
            aria-label="Sede"
            value={siteFilter ?? ''}
            onChange={(event) => setSiteFilter(event.target.value || null)}
            className="rounded-xl border border-line bg-card px-3 py-2 text-sm text-body outline-none focus-visible:outline-2 focus-visible:outline-brand-medium"
          >
            <option value="">Todas las sedes</option>
            {sites.data.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
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
  const siteList = sites.data.items;
  const siteNames = new Map(siteList.map((site) => [site.id, site.name]));
  const employeeNames = new Map(employees.data.items.map((employee) => [employee.id, fullName(employee)]));

  // Live summaries (WebSocket) override the snapshot counters of their site.
  const siteItems = snapshot.data.items.map((item) => ({ ...item, ...live.summaries[item.siteId] }));

  // KPIs follow the site selector, like the alerts feed.
  const scopedItems = siteItems.filter((item) => !siteFilter || item.siteId === siteFilter);
  const scopedAlerts = alerts.filter((alert) => !siteFilter || alert.siteId === siteFilter);
  const expected = scopedItems.reduce((total, item) => total + item.expected, 0);
  const present = scopedItems.reduce((total, item) => total + item.present, 0);
  const countByStatus = (status: Alert['status']) => scopedAlerts.filter((alert) => alert.status === status).length;
  const alertCount = (siteId: string, status?: Alert['status']) =>
    alerts.filter((alert) => alert.siteId === siteId && (status ? alert.status === status : alert.status !== 'RESOLVED')).length;
  // Red: an alert still waits for acknowledgement; amber: people are missing; violet: complete.
  const stateOf = (item: { siteId: string; expected: number; present: number }): TowerSiteState =>
    alertCount(item.siteId, 'OPEN') > 0 ? 'danger' : item.present < item.expected ? 'warn' : 'ok';

  const siteRows = siteItems.map((item) => ({ item, state: stateOf(item) }));
  const issueCount = siteRows.filter((row) => row.state !== 'ok').length;
  const visibleRows = siteView === 'issues' ? siteRows.filter((row) => row.state !== 'ok') : siteRows;
  const mapSites: TowerMapSite[] = siteRows.flatMap(({ item, state }) => {
    const site = siteList.find((candidate) => candidate.id === item.siteId);
    return site
      ? [
          {
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            present: item.present,
            expected: item.expected,
            state,
          },
        ]
      : [];
  });
  const toggleSite = (siteId: string) => setSiteFilter((current) => (current === siteId ? null : siteId));
  const showOnMap = (siteId: string) => {
    setMapFocus((current) => ({ siteId, nonce: (current?.nonce ?? 0) + 1 }));
    // On phones the map sits below the alerts; on desktop it is already in view and nothing scrolls.
    mapSection.current?.scrollIntoView({ block: 'nearest' });
  };

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

      <TowerTelemetryBar
        present={present}
        expected={expected}
        openAlerts={countByStatus('OPEN')}
        acknowledgedAlerts={countByStatus('ACKNOWLEDGED')}
        issuesCount={issueCount}
        activeFilter={filter}
        onlyIssues={siteView === 'issues'}
        onFilterAlerts={setFilter}
        onToggleIssues={() => setSiteView((current) => (current === 'issues' ? 'all' : 'issues'))}
      />

      {/* Phones stack alerts, map, then per-site state; on desktop the alerts take the right column. */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section aria-label="Alertas" className="lg:col-span-2 lg:col-start-4 lg:row-span-2 lg:row-start-1">
          <Card flush glow="none" className="h-full">
            <div className="px-5 pt-5">
              <SectionLabel
                action={
                  siteFilter ? (
                    <Button variant="ghost" onClick={() => setSiteFilter(null)}>
                      Ver todas
                    </Button>
                  ) : (
                    <span className="tw-live" data-live={live.connected}>
                      {live.connected ? 'En vivo' : 'Sin conexión en vivo'}
                    </span>
                  )
                }
              >
                Alertas{siteFilter ? ` · ${siteNames.get(siteFilter) ?? 'Sede'}` : ''}
              </SectionLabel>
              <div className="pb-4">
                <Segmented
                  label="Filtrar alertas por estado"
                  options={ALERT_FILTERS.map((option) => ({
                    value: option,
                    label: FILTER_LABELS[option],
                    count: scopedAlerts.filter((alert) => matchesFilter(alert, option)).length,
                  }))}
                  value={filter}
                  onChange={setFilter}
                />
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
              <ul className="flex flex-col gap-3 px-5 pb-5 lg:max-h-[780px] lg:overflow-y-auto">
                {visibleAlerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    siteName={siteNames.get(alert.siteId) ?? 'Sede'}
                    employeeName={alert.employeeId ? (employeeNames.get(alert.employeeId) ?? null) : null}
                    isBusy={busyIds.includes(alert.id)}
                    isFresh={freshIds.has(alert.id)}
                    onAcknowledge={(id) => runAction(id, telemetryApi.acknowledgeAlert)}
                    onResolve={(id) => runAction(id, (alertId) => telemetryApi.resolveAlert(alertId))}
                    onShowOnMap={showOnMap}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section ref={mapSection} aria-label="Mapa de sedes" className="lg:col-span-3 lg:col-start-1 lg:row-start-1">
          <Card flush glow="none">
            <TowerMap sites={mapSites} selectedId={siteFilter} focus={mapFocus} onSelect={toggleSite} />
          </Card>
        </section>

        <section aria-label="Estado del personal por sede" className="lg:col-span-3 lg:col-start-1 lg:row-start-2">
          <Card flush glow="none">
            <div className="px-5 pt-5">
              <SectionLabel
                action={
                  <Segmented
                    label="Filtrar sedes"
                    options={[
                      { value: 'all', label: 'Todas' },
                      { value: 'issues', label: 'Con problemas', count: issueCount },
                    ]}
                    value={siteView}
                    onChange={setSiteView}
                  />
                }
              >
                Personal por sede
              </SectionLabel>
            </div>
            {visibleRows.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState title="Ninguna sede con problemas" description="Todas tienen su personal y sin alertas abiertas." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {visibleRows.map(({ item, state }) => (
                  <SiteStatusRow
                    key={item.siteId}
                    name={siteNames.get(item.siteId) ?? 'Sede'}
                    expected={item.expected}
                    present={item.present}
                    activeAlerts={alertCount(item.siteId)}
                    state={state}
                    selected={siteFilter === item.siteId}
                    onSelect={() => toggleSite(item.siteId)}
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