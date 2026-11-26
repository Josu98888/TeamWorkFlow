'use client';

import { useState } from 'react';
import { organizationApi } from '@/features/organization';
import { Can } from '@/shared/hooks/useCan';
import { useResource } from '@/shared/hooks/useResource';
import { Badge } from '@/shared/components/Badge';
import { Button, ButtonLink, FilterChip } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { PageHeader } from '@/shared/components/PageHeader';
import { ProgressBar } from '@/shared/components/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { formatDateTime, formatPercent, fullName } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { CreateTaskModal } from './CreateTaskModal';
import { TASK_KIND_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../labels';
import { TASK_STATUSES, type Task, type TaskStatus } from '../types';
import { TaskDetailDrawer } from './TaskDetailDrawer';

type Filter = 'ALL' | TaskStatus;

function formatRelativeDeadline(task: Task): { text: string; urgent: boolean; overdue: boolean } {
  const diffMs = new Date(task.deadline).getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return { text: `vence ${formatDateTime(task.deadline)}`, urgent: false, overdue: false };
  }

  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const span = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  if (task.status === 'COMPLETED') {
    return { text: `plazo ${formatDateTime(task.deadline)}`, urgent: false, overdue: false };
  }
  if (diffMs <= 0) {
    return { text: `venció hace ${span}`, urgent: false, overdue: true };
  }
  const urgent = diffMs <= 2 * 3_600_000;
  return { text: `vence en ${span}`, urgent, overdue: false };
}

export function TasksView() {
  const tasks = useResource(tasksApi.listTasks);
  const report = useResource(tasksApi.getTaskReport);
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const header = (
    <>
      <PageHeader
        title="Tareas y Reportes"
        description="Seguimiento de tareas operativas y cumplimiento por sede."
        secondaryActions={
          <Can capability="forms.manage">
            <ButtonLink href="/tareas/formularios">Formularios</ButtonLink>
          </Can>
        }
        actions={
          <Can capability="tasks.create">
            <Button variant="primary" onClick={() => setCreating(true)}>
              Nueva tarea
            </Button>
          </Can>
        }
      />
      {creating && (
        <CreateTaskModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            tasks.reload();
            report.reload();
          }}
        />
      )}
    </>
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
  const normalizedQuery = query.trim().toLowerCase();

  const visible = tasks.data.filter((task) => {
    if (filter !== 'ALL' && task.status !== filter) return false;
    if (siteFilter !== 'ALL' && task.siteId !== siteFilter) return false;
    if (!normalizedQuery) return true;
    const empName = task.employeeId ? (employeeNames.get(task.employeeId) ?? '').toLowerCase() : '';
    const siteName = (siteNames.get(task.siteId) ?? '').toLowerCase();
    return (
      task.title.toLowerCase().includes(normalizedQuery) ||
      empName.includes(normalizedQuery) ||
      siteName.includes(normalizedQuery)
    );
  });

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
            <p className="text-4xl font-bold tracking-tight tabular-nums text-title">
              {formatPercent(report.data.complianceRate)}
            </p>
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
                    <p className="shrink-0 text-xs tabular-nums text-muted">
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
          <Card flush glow="none">
            <div className="space-y-3 px-5 pt-5 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>Tareas ({visible.length})</SectionLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filtrar tareas por sede"
                    value={siteFilter}
                    onChange={(e) => setSiteFilter(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-body outline-none focus:border-brand-medium"
                  >
                    <option value="ALL">Todas las sedes</option>
                    {sites.data.items.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar tarea o empleado..."
                    aria-label="Buscar tarea o empleado"
                    className="w-44 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-body outline-none placeholder:text-muted focus:border-brand-medium sm:w-52"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
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
                <EmptyState
                  title="No hay tareas con estos filtros"
                  description="Probá limpiar la búsqueda o cambiar el estado o la sede."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {visible.map((task) => {
                  const rel = formatRelativeDeadline(task);
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTask(task)}
                        className="flex w-full flex-wrap items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-alt/60 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-title">{task.title}</p>
                            {task.expectedQr && (
                              <span className="rounded border border-line bg-alt/80 px-1.5 py-0.2 font-mono text-[10px] font-semibold uppercase tracking-wide text-body">
                                QR puesto
                              </span>
                            )}
                            {task.answer && (
                              <span
                                className={`rounded border border-line bg-alt/80 px-1.5 py-0.2 text-[10px] font-semibold ${
                                  task.answer.reviewResult === 'APPROVED'
                                    ? 'text-status-success'
                                    : task.answer.reviewResult === 'OBSERVED'
                                      ? 'text-status-warning'
                                      : 'text-body'
                                }`}
                              >
                                {task.answer.reviewResult === 'APPROVED'
                                  ? 'Aprobada'
                                  : task.answer.reviewResult === 'OBSERVED'
                                    ? 'Observada'
                                    : 'Con evidencia'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-body">
                            <span className="font-semibold">{siteNames.get(task.siteId) ?? 'Sede'}</span>
                            {' · '}
                            {task.employeeId ? (
                              (employeeNames.get(task.employeeId) ?? 'Empleado')
                            ) : (
                              <span className="italic text-muted">Sin reclamar</span>
                            )}
                          </p>
                          <p className="text-xs text-muted">
                            <span>{TASK_KIND_LABELS[task.kind]}</span>
                            {' · '}
                            <span
                              className={`tabular-nums font-medium ${
                                rel.overdue
                                  ? 'text-status-danger'
                                  : rel.urgent
                                    ? 'text-status-warning'
                                    : 'text-muted'
                              }`}
                            >
                              {rel.text}
                            </span>
                            {' · '}
                            <span className="tabular-nums">{formatDateTime(task.deadline)}</span>
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge tone={TASK_STATUS_TONES[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                          <span className="text-[11px] font-medium text-muted">Ver detalle →</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          siteName={siteNames.get(selectedTask.siteId) ?? 'Sede'}
          employeeName={selectedTask.employeeId ? (employeeNames.get(selectedTask.employeeId) ?? 'Empleado') : null}
          onClose={() => setSelectedTask(null)}
          onReviewed={(updated) => {
            setSelectedTask(updated);
            tasks.reload();
          }}
        />
      )}
    </>
  );
}