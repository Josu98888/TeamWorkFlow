'use client';

import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { CheckField } from '@/shared/components/Fields';
import { DataTable } from '@/shared/components/List';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { Can } from '@/shared/hooks/useCan';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { organizationApi } from '../api';
import { SHIFT_STATUS_LABELS, SHIFT_STATUS_TONES, WEEKDAY_ORDER, WEEKDAY_SHORT_LABELS } from '../labels';
import {
  compareEmployeesByDni,
  compareEmployeesByName,
  employeeFullName,
  fetchAllEmployees,
  fetchAllPostsForSite,
  fetchAllTemplates,
  formatScheduleRange,
  formatWeekdaysSummary,
  matchesEmployeeDni,
  matchesEmployeeName,
  type SortDirection,
  type TurnosSearchFilters,
  type WorkerSortField,
} from '../turnos-utils';
import type { Employee, Post, Shift, ShiftTemplate, Site } from '../types';
import { AssignWeeklyWorkerModal } from './AssignWeeklyWorkerModal';
import { ShiftFolderBreadcrumbs } from './ShiftFolderBreadcrumbs';
import { ReassignShiftModal, ShiftFormModal } from './ShiftFormModal';
import { ShiftSearchBar } from './ShiftSearchBar';

type PostScheduleData = {
  site: Site;
  post: Post;
  employees: Employee[];
  templates: ShiftTemplate[];
  shifts: Shift[];
};

async function loadPostScheduleData(arg: { siteId: string; postId: string }): Promise<PostScheduleData> {
  const [site, posts, employees, templates, shiftsPage] = await Promise.all([
    organizationApi.getSite(arg.siteId),
    fetchAllPostsForSite(arg.siteId),
    fetchAllEmployees(),
    fetchAllTemplates({ siteId: arg.siteId, postId: arg.postId }),
    organizationApi.listShifts({ siteId: arg.siteId, pageSize: 100 }),
  ]);

  const post = posts.find((item) => item.id === arg.postId);
  if (!post) throw new Error('El puesto seleccionado no existe en esta sede.');

  return {
    site,
    post,
    employees,
    templates,
    shifts: shiftsPage.items.filter((shift) => shift.postId === arg.postId),
  };
}

function SortColumnButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  const arrow = !active ? '↕' : direction === 'asc' ? '↑' : '↓';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 font-semibold transition-colors ${
        active ? 'text-brand' : 'text-muted hover:text-title'
      }`}
    >
      <span>{label}</span>
      <span aria-hidden className="text-[11px]">
        {arrow}
      </span>
    </button>
  );
}

function WeekdayChips({ weekdays }: { weekdays: readonly number[] }) {
  const activeSet = new Set(weekdays);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {WEEKDAY_ORDER.map((day) => {
          const active = activeSet.has(day);
          const label = WEEKDAY_SHORT_LABELS[day]?.[0] ?? String(day);
          return (
            <span
              key={day}
              title={WEEKDAY_SHORT_LABELS[day]}
              className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                active ? 'bg-brand text-white' : 'bg-alt text-muted'
              }`}
            >
              {label}
            </span>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">{formatWeekdaysSummary(weekdays)}</p>
    </div>
  );
}

/**
 * Level 2 of `/turnos/[siteId]/[postId]`:
 * - 2-field search bar (`Nombre de empleado`, `DNI`)
 * - Sortable table by `Nombre` (asc/desc) and `DNI` (asc/desc) with weekly schedule & days
 * - Manage recurring weekly worker assignments and individual shifts
 */
export function PostScheduleView({ siteId, postId }: { siteId: string; postId: string }) {
  const { data, error, isLoading, reload } = useResource(loadPostScheduleData, { siteId, postId });
  const [filters, setFilters] = useState<TurnosSearchFilters>({});
  const [sortField, setSortField] = useState<WorkerSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [assigningNew, setAssigningNew] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [creatingShift, setCreatingShift] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [reassigningShift, setReassigningShift] = useState<Shift | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { run, pending, error: actionError } = useAction();

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message={error?.message ?? 'No se pudo cargar el detalle del puesto.'} onRetry={reload} />;
  }

  const employeeById = new Map(data.employees.map((emp) => [emp.id, emp]));
  const empQuery = filters.employeeQuery ?? '';
  const dniQuery = filters.dniQuery ?? '';

  const toggleSort = (field: WorkerSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredTemplates = data.templates
    .filter((tpl) => {
      if (!includeInactive && !tpl.isActive) return false;
      const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
      return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
    })
    .toSorted((a, b) => {
      const empA = a.employeeId ? employeeById.get(a.employeeId) : undefined;
      const empB = b.employeeId ? employeeById.get(b.employeeId) : undefined;
      const primary =
        sortField === 'name'
          ? compareEmployeesByName(empA, empB, sortDirection)
          : compareEmployeesByDni(empA, empB, sortDirection);
      return primary !== 0 ? primary : compareEmployeesByName(empA, empB, 'asc');
    });

  const filteredShifts = data.shifts
    .filter((shift) => {
      const emp = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
      return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
    })
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));

  const inactiveCount = data.templates.filter((tpl) => !tpl.isActive).length;

  const handleDeactivateTemplate = async (tpl: ShiftTemplate) => {
    const updated = await run(() => organizationApi.deactivateShiftTemplate(tpl.id));
    if (updated) {
      setFeedback('Asignación semanal desactivada.');
      reload();
    }
  };

  const handleCancelShift = async (shift: Shift) => {
    const cancelled = await run(() => organizationApi.cancelShift(shift.id, { version: shift.version }));
    if (cancelled) {
      setFeedback('Turno puntual cancelado.');
      reload();
    }
  };

  const onSavedTemplate = (message: string) => {
    setAssigningNew(false);
    setEditingTemplate(null);
    setFeedback(message);
    reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: `/turnos/${siteId}`, label: `Volver a ${data.site.name}` }}
        title={data.post.name}
        description={`${data.site.name} · Mínimo requerido: ${data.post.minPeople} ${
          data.post.minPeople === 1 ? 'persona' : 'personas'
        }.`}
        badge={<Badge tone={data.post.isActive ? 'success' : 'neutral'}>{data.post.isActive ? 'Puesto activo' : 'Puesto inactivo'}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Can capability="shifts.manage">
              <Button variant="secondary" onClick={() => setCreatingShift(true)}>
                Turno puntual
              </Button>
            </Can>
            <Can capability="shiftTemplates.manage">
              <Button variant="primary" onClick={() => setAssigningNew(true)}>
                Asignar trabajador
              </Button>
            </Can>
          </div>
        }
      />

      <ShiftFolderBreadcrumbs
        site={{ id: data.site.id, name: data.site.name }}
        post={{ id: data.post.id, name: data.post.name }}
      />

      <ShiftSearchBar level="post" filters={filters} onChange={setFilters} onClear={() => setFilters({})} />

      {(feedback || actionError) && (
        <Card className="flex items-center justify-between gap-3 py-3">
          <p className={`text-xs font-medium ${actionError ? 'text-danger' : 'text-success'}`}>
            {actionError ?? feedback}
          </p>
          <Button variant="ghost" onClick={() => setFeedback(null)}>
            Ocultar
          </Button>
        </Card>
      )}

      <Card flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-title">Trabajadores asignados y horario semanal</h2>
            <p className="text-xs text-muted">
              Ordenable por Nombre o DNI ({sortField === 'name' ? 'Nombre' : 'DNI'}{' '}
              {sortDirection === 'asc' ? 'ascendente' : 'descendente'}).
            </p>
          </div>
          {inactiveCount > 0 && (
            <CheckField
              label={`Incluir desactivados (${inactiveCount})`}
              checked={includeInactive}
              onChange={setIncludeInactive}
            />
          )}
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No hay trabajadores asignados con estos filtros"
              description="Usá «Asignar trabajador» para configurar días y horario de trabajo en este puesto."
              action={
                <Can capability="shiftTemplates.manage">
                  <Button variant="primary" className="mt-3" onClick={() => setAssigningNew(true)}>
                    Asignar trabajador
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>
                  <SortColumnButton
                    label="Trabajador"
                    active={sortField === 'name'}
                    direction={sortDirection}
                    onClick={() => toggleSort('name')}
                  />
                </th>
                <th>
                  <SortColumnButton
                    label="DNI"
                    active={sortField === 'dni'}
                    direction={sortDirection}
                    onClick={() => toggleSort('dni')}
                  />
                </th>
                <th>Días de trabajo</th>
                <th>Horario</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((tpl) => {
                const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
                return (
                  <tr key={tpl.id}>
                    <td>
                      <p className="font-semibold text-title">
                        {emp ? employeeFullName(emp) : 'Sin trabajador asignado'}
                      </p>
                      <p className="text-[11px] text-muted">
                        {emp?.employeeNumber ? `Legajo ${emp.employeeNumber}` : emp?.email ?? 'Puesto vacante'}
                      </p>
                    </td>
                    <td className="font-mono text-xs text-body tabular-nums">{emp?.nationalId ?? '—'}</td>
                    <td>
                      <WeekdayChips weekdays={tpl.weekdays} />
                    </td>
                    <td>
                      <span className="font-mono text-xs font-semibold text-title tabular-nums">
                        {formatScheduleRange(tpl.startTime, tpl.durationMinutes)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={tpl.isActive ? 'success' : 'neutral'}>
                        {tpl.isActive ? 'Activa' : 'Desactivada'}
                      </Badge>
                    </td>
                    <td>
                      <Can capability="shiftTemplates.manage" fallback={<span className="text-xs text-muted">Solo lectura</span>}>
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="secondary" disabled={pending} onClick={() => setEditingTemplate(tpl)}>
                            Editar
                          </Button>
                          {tpl.isActive && (
                            <Button
                              variant="ghost"
                              disabled={pending}
                              onClick={() => void handleDeactivateTemplate(tpl)}
                            >
                              Desactivar
                            </Button>
                          )}
                        </div>
                      </Can>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card flush className="overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-title">Turnos generados y puntuales</h2>
          <p className="text-xs text-muted">
            Ocurrencias programadas en {data.post.name} (ordenadas por fecha de inicio).
          </p>
        </div>

        {filteredShifts.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Sin turnos generados para los filtros actuales"
              description="Al asignar un horario semanal se generan automáticamente los turnos de los próximos 14 días."
            />
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Fecha y horario</th>
                <th>Trabajador</th>
                <th>DNI</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredShifts.map((shift) => {
                const emp = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
                const editable = shift.status === 'SCHEDULED';
                return (
                  <tr key={shift.id}>
                    <td className="font-mono text-xs text-body tabular-nums">
                      {formatDateTime(shift.startsAt)} – {formatDateTime(shift.endsAt)}
                    </td>
                    <td>{emp ? employeeFullName(emp) : 'Sin asignar'}</td>
                    <td className="font-mono text-xs text-muted tabular-nums">{emp?.nationalId ?? '—'}</td>
                    <td>
                      <Badge tone={SHIFT_STATUS_TONES[shift.status]}>{SHIFT_STATUS_LABELS[shift.status]}</Badge>
                    </td>
                    <td>
                      <Can capability="shifts.manage">
                        {editable ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button variant="secondary" disabled={pending} onClick={() => setEditingShift(shift)}>
                              Editar
                            </Button>
                            <Button variant="secondary" disabled={pending} onClick={() => setReassigningShift(shift)}>
                              Reasignar
                            </Button>
                            <Button variant="ghost" disabled={pending} onClick={() => void handleCancelShift(shift)}>
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Can>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>

      {(assigningNew || editingTemplate) && (
        <AssignWeeklyWorkerModal
          siteId={siteId}
          postId={postId}
          postName={data.post.name}
          employees={data.employees}
          template={editingTemplate ?? undefined}
          onClose={() => {
            setAssigningNew(false);
            setEditingTemplate(null);
          }}
          onSaved={onSavedTemplate}
        />
      )}

      {(creatingShift || editingShift) && (
        <ShiftFormModal
          shift={editingShift ?? undefined}
          sites={[data.site]}
          employees={data.employees}
          onClose={() => {
            setCreatingShift(false);
            setEditingShift(null);
          }}
          onSaved={() => {
            setCreatingShift(false);
            setEditingShift(null);
            reload();
          }}
        />
      )}

      {reassigningShift && (
        <ReassignShiftModal
          shift={reassigningShift}
          employees={data.employees}
          onClose={() => setReassigningShift(null)}
          onSaved={() => {
            setReassigningShift(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
