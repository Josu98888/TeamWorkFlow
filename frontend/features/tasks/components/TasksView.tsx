'use client';

import { useState } from 'react';
import { organizationApi } from '@/features/organization';
import { useResource } from '@/shared/hooks/useResource';
import { Badge } from '@/shared/components/Badge';
import { FilterChip } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { PageHeader } from '@/shared/components/PageHeader';
import { ProgressBar } from '@/shared/components/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { formatDateTime, formatPercent, fullName } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { TASK_KIND_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../labels';
import { TASK_STATUSES, type TaskStatus } from '../types';

type Filter = 'ALL' | TaskStatus;

export function TasksView() {
  const tasks = useResource(tasksApi.listTasks);
  const report = useResource(tasksApi.getTaskReport);
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);
  const [filter, setFilter] = useState<Filter>('ALL');

  const header = (
    <PageHeader title="Tareas y Reportes" description="Seguimiento de tareas operativas y cumplimiento por sede." />
  );

  if (tasks.error || report.error || sites.error || employees.error) {
    return (
      <>
        {header}
        <ErrorState
          message="No pudimos cargar las tareas."
          onRetry={() => {
            tasks.reload();
            report.reload();
            sites.reload();
            employees.reload();
          }}
        />
      </>
    );
  }

  if (!tasks.data || !report.data || !sites.data || !employees.data) {
    return (
      <>
        {header}
        <LoadingState rows={3} />
      </>
    );
  }

  const siteNames = new Map(sites.data.items.map((site) => [site.id, site.name]));
  const employeeNames = new Map(employees.data.items.map((employee) => [employee.id, fullName(employee)]));
  const visible = tasks.data.filter((task) => filter === 'ALL' || task.status === filter);
  const { byStatus } = report.data;
  const closed = byStatus.COMPLETED + byStatus.EXPIRED;

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label="Total de tareas" value={report.data.total} hint="Del día y programadas" />
        <KpiTile label="Pendientes" value={report.data.byStatus.PENDING} hint="Dentro de plazo" tone="info" />
        <KpiTile label="Completadas" value={report.data.byStatus.COMPLETED} hint="Cerradas a tiempo" tone="success" />
        <KpiTile
          label="Vencidas"
          value={report.data.byStatus.EXPIRED}
          hint="Sin completar en plazo"
          tone={report.data.byStatus.EXPIRED > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section aria-label="Reporte de cumplimiento" className="lg:col-span-2">
          <Card className="h-full">
            <SectionLabel>Cumplimiento</SectionLabel>
            <p className="text-4xl font-bold tracking-tight text-title">{formatPercent(report.data.complianceRate)}</p>
            <p className="mb-3 mt-1 text-xs text-muted">
              {report.data.byStatus.COMPLETED} de {closed} tareas cerradas se completaron en plazo.
            </p>
            <ProgressBar label="Cumplimiento general" value={report.data.byStatus.COMPLETED} max={closed} />

            <h3 className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">Por sede</h3>
            <ul className="space-y-4">
              {report.data.bySite.map((row) => (
                <li key={row.siteId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-title">{siteNames.get(row.siteId) ?? 'Sede'}</p>
                    <p className="shrink-0 text-xs text-muted">
                      {row.completed}/{row.total} completadas
                    </p>
                  </div>
                  <ProgressBar
                    label={`Tareas completadas en ${siteNames.get(row.siteId) ?? 'la sede'}`}
                    value={row.completed}
                    max={row.total}
                    tone={row.expired > 0 ? 'warning' : 'success'}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section aria-label="Listado de tareas" className="lg:col-span-3">
          <Card flush>
            <div className="px-5 pt-5">
              <SectionLabel>Tareas</SectionLabel>
              <div className="flex flex-wrap gap-2 pb-4">
                <FilterChip
                  label="Todas"
                  count={tasks.data.length}
                  active={filter === 'ALL'}
                  onSelect={() => setFilter('ALL')}
                />
                {TASK_STATUSES.map((status) => (
                  <FilterChip
                    key={status}
                    label={TASK_STATUS_LABELS[status]}
                    count={byStatus[status]}
                    active={filter === status}
                    onSelect={() => setFilter(status)}
                  />
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState title="No hay tareas con este estado" description="Elegí otro filtro para ver más." />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {visible.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-title">{task.title}</p>
                      <p className="mt-1 text-xs text-body">
                        <span className="font-semibold">{siteNames.get(task.siteId) ?? 'Sede'}</span>
                        {' · '}
                        {task.employeeId ? (employeeNames.get(task.employeeId) ?? 'Empleado') : 'Sin reclamar'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {TASK_KIND_LABELS[task.kind]} · vence {formatDateTime(task.deadline)}
                      </p>
                    </div>
                    <Badge tone={TASK_STATUS_TONES[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
