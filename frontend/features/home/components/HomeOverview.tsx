'use client';

import Link from 'next/link';
import { organizationApi } from '@/features/organization';
import { telemetryApi } from '@/features/telemetry';
import { tasksApi, type Task } from '@/features/tasks';
import { useResource } from '@/shared/hooks/useResource';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { PageHeader } from '@/shared/components/PageHeader';
import { ProgressBar } from '@/shared/components/ProgressBar';
import { ErrorState, LoadingState } from '@/shared/components/States';
import { formatDateTime, formatLongDate, formatPercent, fullName } from '@/shared/lib/format';

function formatUrgency(task: Task): { label: string; overdue: boolean; urgent: boolean } {
  const diffMs = new Date(task.deadline).getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return { label: formatDateTime(task.deadline), overdue: false, urgent: false };
  }
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const span = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  if (diffMs <= 0 || task.status === 'EXPIRED') {
    return { label: `Venció hace ${span}`, overdue: true, urgent: false };
  }
  return {
    label: `Vence en ${span}`,
    overdue: false,
    urgent: diffMs <= 2 * 3_600_000,
  };
}

export function HomeOverview() {
  const sites = useResource(organizationApi.listSites);
  const tower = useResource(telemetryApi.getTowerSnapshot);
  const report = useResource(tasksApi.getTaskReport);
  const tasks = useResource(tasksApi.listTasks);
  const employees = useResource(organizationApi.listEmployees);

  const header = (
    <PageHeader
      title="Panel Principal"
      description={capitalize(formatLongDate())}
      secondaryActions={<ButtonLink href="/torre-control">Torre de Control</ButtonLink>}
      actions={
        <ButtonLink href="/tareas" variant="primary">
          Ver tareas
        </ButtonLink>
      }
    />
  );

  const error = sites.error ?? tower.error ?? report.error ?? tasks.error ?? employees.error;
  if (error) {
    return (
      <>
        {header}
        <ErrorState
          message="No pudimos cargar el resumen operativo."
          onRetry={() => {
            sites.reload();
            tower.reload();
            report.reload();
            tasks.reload();
            employees.reload();
          }}
        />
      </>
    );
  }

  if (!sites.data || !tower.data || !report.data || !tasks.data || !employees.data) {
    return (
      <>
        {header}
        <LoadingState rows={3} />
      </>
    );
  }

  const siteNames = new Map(sites.data.items.map((site) => [site.id, site.name]));
  const employeeNames = new Map(employees.data.items.map((emp) => [emp.id, fullName(emp)]));

  const activeSites = sites.data.items.filter((site) => site.isActive).length;
  const expected = sum(tower.data.items.map((item) => item.expected));
  const present = sum(tower.data.items.map((item) => item.present));
  const openAlerts = sum(tower.data.items.map((item) => item.openAlerts));
  const closedTasks = report.data.byStatus.COMPLETED + report.data.byStatus.EXPIRED;

  const priorityTasks = tasks.data
    .filter((t) => t.status === 'PENDING' || t.status === 'EXPIRED')
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {header}

      {/* Top KPI Row */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile
          label="Presentes ahora"
          value={`${present}/${expected}`}
          hint={`${activeSites} de ${sites.data.total} sedes activas`}
          tone={present < expected ? 'warning' : 'success'}
          href="/torre-control"
        />
        <KpiTile
          label="Alertas activas"
          value={openAlerts}
          hint={openAlerts > 0 ? 'Requieren atención en sede' : 'Sin incidentes abiertos'}
          tone={openAlerts > 0 ? 'danger' : 'success'}
          href="/torre-control"
        />
        <KpiTile
          label="Tareas pendientes"
          value={report.data.byStatus.PENDING}
          hint={
            report.data.byStatus.EXPIRED > 0
              ? `${report.data.byStatus.EXPIRED} vencidas sin cerrar`
              : 'Todas dentro de plazo'
          }
          tone={report.data.byStatus.EXPIRED > 0 ? 'warning' : 'info'}
          href="/tareas"
        />
        <KpiTile
          label="Cumplimiento"
          value={formatPercent(report.data.complianceRate)}
          hint={`${report.data.byStatus.COMPLETED} de ${closedTasks} cerradas a tiempo`}
          tone={report.data.complianceRate >= 80 ? 'success' : 'warning'}
          href="/tareas"
        />
      </div>

      {/* Main Operational Split: Live Site Coverage + Priority Tasks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Live Site Coverage Table */}
        <section aria-label="Cobertura por sede" className="lg:col-span-7">
          <Card flush glow="none" className="h-full">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <SectionLabel>Cobertura operativa por sede</SectionLabel>
                <p className="text-xs text-muted">Dotación presente en turno y alertas abiertas por ubicación</p>
              </div>
              <Link href="/torre-control" className="text-xs font-semibold text-link hover:underline">
                Abrir torre →
              </Link>
            </div>

            {tower.data.items.length === 0 ? (
              <p className="px-5 py-6 text-xs text-muted">No hay sedes con turnos activos en este momento.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-alt/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="px-5 py-2.5">Sede</th>
                      <th className="px-4 py-2.5">Dotación</th>
                      <th className="px-4 py-2.5">Cobertura</th>
                      <th className="px-5 py-2.5 text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {tower.data.items.map((item) => {
                      const ratio = item.expected > 0 ? Math.round((item.present / item.expected) * 100) : 100;
                      const understaffed = item.present < item.expected;
                      return (
                        <tr key={item.siteId} className="transition-colors hover:bg-alt/40">
                          <td className="px-5 py-3.5 font-semibold text-title">
                            <Link href="/torre-control" className="hover:underline">
                              {siteNames.get(item.siteId) ?? 'Sede'}
                            </Link>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-body">
                            <span className="font-semibold text-title">{item.present}</span> / {item.expected} presentes
                          </td>
                          <td className="w-40 px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <ProgressBar
                                  label={`Cobertura en ${siteNames.get(item.siteId) ?? 'sede'}`}
                                  value={item.present}
                                  max={Math.max(item.expected, 1)}
                                  tone={item.openAlerts > 0 ? 'danger' : understaffed ? 'warning' : 'success'}
                                />
                              </div>
                              <span className="w-9 text-right tabular-nums text-[11px] font-medium text-muted">
                                {ratio}%
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {item.openAlerts > 0 ? (
                              <Badge tone="danger">
                                {item.openAlerts} {item.openAlerts === 1 ? 'alerta' : 'alertas'}
                              </Badge>
                            ) : understaffed ? (
                              <Badge tone="warning">Falta personal</Badge>
                            ) : (
                              <Badge tone="success">Cubierta</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        {/* Right: Next Deadlines & Overdue Tasks */}
        <section aria-label="Próximos vencimientos de tareas" className="lg:col-span-5">
          <Card flush glow="none" className="h-full">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <SectionLabel>Prioridades del turno</SectionLabel>
                <p className="text-xs text-muted">Tareas vencidas y próximos vencimientos</p>
              </div>
              <Link href="/tareas" className="text-xs font-semibold text-link hover:underline">
                Todas ({tasks.data.length}) →
              </Link>
            </div>

            {priorityTasks.length === 0 ? (
              <p className="px-5 py-6 text-xs text-muted">No hay tareas pendientes ni vencidas en este momento.</p>
            ) : (
              <ul className="divide-y divide-line">
                {priorityTasks.map((task) => {
                  const urgency = formatUrgency(task);
                  return (
                    <li key={task.id}>
                      <Link
                        href="/tareas"
                        className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-alt/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-title">{task.title}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            <span className="font-medium text-body">{siteNames.get(task.siteId) ?? 'Sede'}</span>
                            {' · '}
                            {task.employeeId ? (employeeNames.get(task.employeeId) ?? 'Empleado') : 'Sin reclamar'}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md border border-line bg-alt/70 px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                            urgency.overdue
                              ? 'text-status-danger'
                              : urgency.urgent
                                ? 'text-status-warning'
                                : 'text-body'
                          }`}
                        >
                          {urgency.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);