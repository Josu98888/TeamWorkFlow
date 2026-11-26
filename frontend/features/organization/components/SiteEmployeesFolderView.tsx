'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Button, ButtonLink } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { CheckField } from '@/shared/components/Fields';
import { DataTable } from '@/shared/components/List';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { Can } from '@/shared/hooks/useCan';
import { useResource } from '@/shared/hooks/useResource';
import { fullName, initials } from '@/shared/lib/format';
import { organizationApi } from '../api';
import {
  compareEmployeesByDni,
  compareEmployeesByName,
  employeeFullName,
  fetchAllEmployees,
  fetchAllPostsForSite,
  fetchAllSites,
  fetchAllTemplates,
  type SortDirection,
  type WorkerSortField,
} from '../turnos-utils';
import type {
  Employee,
  InviteEmployee,
  InviteRoleOption,
  Post,
  Shift,
  ShiftTemplate,
  Site,
} from '../types';
import { BulkImportEmployeesModal } from './BulkImportEmployeesModal';
import { EmployeeFolderBreadcrumbs } from './EmployeeFolderBreadcrumbs';
import { EmployeeFormModal } from './EmployeeFormModal';
import {
  EmployeeSearchBar,
  matchesWorkerDni,
  matchesWorkerFullName,
  type EmployeesSearchFilters,
} from './EmployeeSearchBar';

type SiteEmployeesFolderData = {
  site: Site;
  allSites: Site[];
  posts: Post[];
  employees: Employee[];
  templates: ShiftTemplate[];
  shifts: Shift[];
};

async function loadSiteEmployeesFolderData(siteId: string): Promise<SiteEmployeesFolderData> {
  const [site, allSites, posts, employees, templates, shiftsPage] = await Promise.all([
    organizationApi.getSite(siteId),
    fetchAllSites(),
    fetchAllPostsForSite(siteId),
    fetchAllEmployees(siteId),
    fetchAllTemplates({ siteId }),
    organizationApi.listShifts({ siteId, pageSize: 100 }),
  ]);

  return {
    site,
    allSites,
    posts,
    employees,
    templates,
    shifts: shiftsPage.items,
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

/**
 * Level 1 of `/empleados/[siteId]`:
 * - Lists all workers assigned/enabled in `siteId`
 * - Shows which posts (`puestos`) each worker is in charge of in this site
 * - Provides top search by `Nombre y apellido` + `DNI`
 * - Provides `Nuevo empleado` and `Cargar Excel de usuarios` (`DNI|NombreApellido|email|contrasena`)
 */
export function SiteEmployeesFolderView({
  siteId,
  onInvite,
  inviteRoles = [],
}: {
  siteId: string;
  onInvite?: InviteEmployee;
  inviteRoles?: readonly InviteRoleOption[];
}) {
  const { data, error, isLoading, reload } = useResource(loadSiteEmployeesFolderData, siteId);
  const [filters, setFilters] = useState<EmployeesSearchFilters>({});
  const [sortField, setSortField] = useState<WorkerSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [onlyActive, setOnlyActive] = useState(false);
  const [form, setForm] = useState<Employee | 'new' | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return (
      <ErrorState
        message={error?.message ?? 'No se pudo cargar la carpeta de empleados de esta sede.'}
        onRetry={reload}
      />
    );
  }

  const postById = new Map(data.posts.map((post) => [post.id, post]));
  const assignedPostIdsByEmployee = new Map<string, Set<string>>();

  const registerPostAssignment = (empId: string | null, pId: string) => {
    if (!empId || !postById.has(pId)) return;
    let bucket = assignedPostIdsByEmployee.get(empId);
    if (!bucket) {
      bucket = new Set<string>();
      assignedPostIdsByEmployee.set(empId, bucket);
    }
    bucket.add(pId);
  };

  for (const tpl of data.templates) {
    if (tpl.isActive) {
      registerPostAssignment(tpl.employeeId, tpl.postId);
    }
  }
  for (const shift of data.shifts) {
    if (shift.status !== 'CANCELLED') {
      registerPostAssignment(shift.employeeId, shift.postId);
    }
  }

  const getPostsForEmployee = (empId: string): Post[] => {
    const ids = assignedPostIdsByEmployee.get(empId);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map((id) => postById.get(id))
      .filter((post): post is Post => Boolean(post))
      .toSorted((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  };

  const toggleSort = (field: WorkerSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const employeeQuery = filters.employeeQuery ?? '';
  const dniQuery = filters.dniQuery ?? '';

  const filteredEmployees = data.employees
    .filter((employee) => {
      if (onlyActive && !employee.isActive) return false;
      return (
        matchesWorkerFullName(employee, employeeQuery) &&
        matchesWorkerDni(employee, dniQuery)
      );
    })
    .toSorted((a, b) => {
      const primary =
        sortField === 'name'
          ? compareEmployeesByName(a, b, sortDirection)
          : compareEmployeesByDni(a, b, sortDirection);
      if (primary !== 0) return primary;
      return compareEmployeesByName(a, b, 'asc');
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.site.name}
        description={`${data.site.address} · Personal habilitado en la sede y puestos a su cargo.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/empleados" variant="ghost">
              ← Sedes
            </ButtonLink>
            <Can capability="employees.manage">
              <Button variant="secondary" onClick={() => setBulkImportOpen(true)}>
                Cargar Excel de usuarios
              </Button>
              <Button variant="primary" onClick={() => setForm('new')}>
                Nuevo empleado
              </Button>
            </Can>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <EmployeeFolderBreadcrumbs site={data.site} />
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={data.site.isActive ? 'success' : 'neutral'}>
            {data.site.isActive ? 'Sede activa' : 'Sede inactiva'}
          </Badge>
          <CheckField
            label="Solo trabajadores activos"
            checked={onlyActive}
            onChange={setOnlyActive}
          />
        </div>
      </div>

      <EmployeeSearchBar
        level="site"
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters({})}
      />

      {form && (
        <EmployeeFormModal
          employee={form === 'new' ? undefined : form}
          sites={data.allSites.length > 0 ? data.allSites : [data.site]}
          defaultSiteId={data.site.id}
          onInvite={onInvite}
          inviteRoles={inviteRoles}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      )}

      {bulkImportOpen && (
        <BulkImportEmployeesModal
          site={data.site}
          onClose={() => setBulkImportOpen(false)}
          onImported={reload}
        />
      )}

      {data.employees.length === 0 ? (
        <EmptyState
          title="Esta sede todavía no tiene trabajadores asignados"
          description="Usá Nuevo empleado o Cargar Excel de usuarios para incorporar personal directamente en esta sede."
          action={
            <Can capability="employees.manage">
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => setBulkImportOpen(true)}>
                  Cargar Excel de usuarios
                </Button>
                <Button variant="primary" onClick={() => setForm('new')}>
                  Nuevo empleado
                </Button>
              </div>
            </Can>
          }
        />
      ) : filteredEmployees.length === 0 ? (
        <EmptyState
          title="Sin trabajadores para los filtros aplicados"
          description="Probá ajustando el nombre, apellido o DNI en el buscador superior."
        />
      ) : (
        <Card flush glow="none">
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
                <th>Puestos a su cargo</th>
                <th>Habilidades</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => {
                const assignedPosts = getPostsForEmployee(employee.id);
                return (
                  <tr key={employee.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar initials={initials(employee)} label={fullName(employee)} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-title">
                            {employeeFullName(employee)}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {employee.email}
                            {employee.employeeNumber ? ` · Legajo ${employee.employeeNumber}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-body">
                      {employee.nationalId ?? '—'}
                    </td>
                    <td>
                      {assignedPosts.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {assignedPosts.map((post) => (
                            <Link key={post.id} href={`/turnos/${data.site.id}/${post.id}`}>
                              <Badge tone="info">{post.name}</Badge>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">Sin puestos a cargo</span>
                          <Link
                            href={`/turnos/${data.site.id}`}
                            className="text-[11px] font-semibold text-link hover:underline"
                          >
                            Asignar puesto
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>
                      {employee.skills.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {employee.skills.map((skill) => (
                            <Badge key={skill} tone="neutral">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={employee.isActive ? 'success' : 'neutral'}>
                        {employee.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Can capability="employees.manage">
                        <Button variant="ghost" onClick={() => setForm(employee)}>
                          Editar
                        </Button>
                      </Can>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      )}
    </div>
  );
}
