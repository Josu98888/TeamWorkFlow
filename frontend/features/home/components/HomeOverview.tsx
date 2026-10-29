'use client';

import Link from 'next/link';
import { organizationApi } from '@/features/organization';
import { telemetryApi } from '@/features/telemetry';
import { tasksApi } from '@/features/tasks';
import { useResource } from '@/shared/hooks/useResource';
import { Badge } from '@/shared/components/Badge';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { PageHeader } from '@/shared/components/PageHeader';
import { ProgressBar } from '@/shared/components/ProgressBar';
import { ErrorState, LoadingState } from '@/shared/components/States';
import { formatLongDate, formatPercent } from '@/shared/lib/format';

const AREAS = [
  {
    href: '/torre-control',
    title: 'Torre de Control',
    description: 'Presencia del personal por sede y alertas en tiempo real.',
  },
  {
    href: '/sedes',
    title: 'Sedes y Geocercas',
    description: 'Sedes, geocercas, puestos, empleados y turnos.',
  },
  {
    href: '/tareas',
    title: 'Tareas y Reportes',
    description: 'Seguimiento de tareas y cumplimiento operativo.',
  },
] as const;

export function HomeOverview() {
  const sites = useResource(organizationApi.listSites);
  const tower = useResource(telemetryApi.getTowerSnapshot);
  const report = useResource(tasksApi.getTaskReport);

  const header = <PageHeader title="Panel Principal" description={capitalize(formatLongDate())} />;

  const error = sites.error ?? tower.error ?? report.error;
  if (error) {
    return (
      <>
        {header}
        <ErrorState
          message="No pudimos cargar el resumen."
          onRetry={() => {
            sites.reload();
            tower.reload();
            report.reload();
          }}
        />
      </>
    );
  }

  if (!sites.data || !tower.data || !report.data) {
    return (
      <>
        {header}
        <LoadingState rows={2} />
      </>
    );
  }

  const siteNames = new Map(sites.data.items.map((site) => [site.id, site.name]));
  const activeSites = sites.data.items.filter((site) => site.isActive).length;
  const expected = sum(tower.data.items.map((item) => item.expected));
  const present = sum(tower.data.items.map((item) => item.present));
  const openAlerts = sum(tower.data.items.map((item) => item.openAlerts));
  const attention = tower.data.items.filter((item) => item.openAlerts > 0 || item.present < item.expected);

  const summaries = {
    '/torre-control': `${present} de ${expected} presentes · ${openAlerts} alertas activas`,
    '/sedes': `${activeSites} sedes activas de ${sites.data.total}`,
    '/tareas': `${report.data.byStatus.PENDING} pendientes · ${formatPercent(report.data.complianceRate)} de cumplimiento`,
  } as const;

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Sedes activas" value={activeSites} hint={`${sites.data.total} sedes en total`} href="/sedes" />
        <KpiTile
          label="Presentes ahora"
          value={`${present}/${expected}`}
          hint="Personal que fichó entrada"
          tone={present < expected ? 'warning' : 'success'}
          href="/torre-control"
        />
        <KpiTile
          label="Alertas activas"
          value={openAlerts}
          hint="Abiertas o reconocidas"
          tone={openAlerts > 0 ? 'danger' : 'success'}
          href="/torre-control"
        />
        <KpiTile
          label="Tareas pendientes"
          value={report.data.byStatus.PENDING}
          hint={`${report.data.byStatus.EXPIRED} vencidas`}
          tone={report.data.byStatus.EXPIRED > 0 ? 'warning' : 'neutral'}
          href="/tareas"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {AREAS.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
          >
            <Card className="h-full transition-colors group-hover:bg-alt">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-teal">Área</p>
              <h2 className="mt-1 text-lg font-bold text-title">{area.title}</h2>
              <p className="mt-1 text-sm text-muted">{area.description}</p>
              <p className="mt-4 text-xs font-semibold text-subtitle">{summaries[area.href]}</p>
              <p className="mt-3 text-xs font-semibold text-link group-hover:underline">Abrir &rarr;</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionLabel>Sedes que requieren atención</SectionLabel>
          {attention.length === 0 ? (
            <p className="text-sm text-muted">Todas las sedes están cubiertas y sin alertas.</p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((item) => (
                <li key={item.siteId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-title">{siteNames.get(item.siteId) ?? 'Sede'}</p>
                    <p className="text-xs text-muted">
                      {item.present} de {item.expected} presentes
                    </p>
                  </div>
                  {item.openAlerts > 0 && (
                    <Badge tone="danger">
                      {item.openAlerts} {item.openAlerts === 1 ? 'alerta' : 'alertas'}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionLabel>Cumplimiento de tareas</SectionLabel>
          <p className="text-3xl font-bold tracking-tight text-title">{formatPercent(report.data.complianceRate)}</p>
          <p className="mb-3 text-xs text-muted">Completadas sobre cerradas (completadas + vencidas)</p>
          <ProgressBar
            label="Cumplimiento de tareas"
            value={report.data.byStatus.COMPLETED}
            max={report.data.byStatus.COMPLETED + report.data.byStatus.EXPIRED}
          />
        </Card>
      </div>
    </>
  );
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
