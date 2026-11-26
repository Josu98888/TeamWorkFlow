'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { fullName } from '@/shared/lib/format';
import {
  fetchAllEmployees,
  fetchAllPostsForSite,
  fetchAllSites,
} from '../turnos-utils';
import type { Employee, Post, Site } from '../types';
import { EmployeeFolderBreadcrumbs } from './EmployeeFolderBreadcrumbs';
import {
  EmployeeSearchBar,
  matchesSiteSearch,
  matchesWorkerDni,
  matchesWorkerFullName,
  type EmployeesSearchFilters,
} from './EmployeeSearchBar';

type RootEmployeesData = {
  sites: Site[];
  postsBySite: Record<string, Post[]>;
  employees: Employee[];
};

async function loadRootEmployeesData(): Promise<RootEmployeesData> {
  const [sites, employees] = await Promise.all([
    fetchAllSites(),
    fetchAllEmployees(),
  ]);
  const postEntries = await Promise.all(
    sites.map(async (site) => [site.id, await fetchAllPostsForSite(site.id)] as const),
  );
  return {
    sites,
    postsBySite: Object.fromEntries(postEntries),
    employees,
  };
}

function FolderGlyph() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M3 6a2 2 0 0 1 2-2h4.2c.6 0 1.2.28 1.6.76L12 6.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    </span>
  );
}

/**
 * Level 0 of `/empleados`: folder grid exclusively of Sites (`Sedes`), with the
 * 3-field search bar (`Sede`, `Nombre y apellido`, `DNI`).
 */
export function EmployeesRootView() {
  const { data, error, isLoading, reload } = useResource(loadRootEmployeesData);
  const [filters, setFilters] = useState<EmployeesSearchFilters>({});

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return (
      <ErrorState
        message={error?.message ?? 'No se pudieron cargar las carpetas de empleados por sede.'}
        onRetry={reload}
      />
    );
  }

  const siteQuery = filters.siteQuery ?? '';
  const employeeQuery = filters.employeeQuery ?? '';
  const dniQuery = filters.dniQuery ?? '';
  const filteringWorkers = employeeQuery.trim().length > 0 || dniQuery.trim().length > 0;

  const employeesBySite = new Map<string, Employee[]>();
  for (const site of data.sites) {
    employeesBySite.set(
      site.id,
      data.employees.filter((employee) => employee.siteIds.includes(site.id)),
    );
  }

  const matchingSites = data.sites.filter((site) => {
    if (!matchesSiteSearch(site, siteQuery)) return false;
    if (!filteringWorkers) return true;
    const siteWorkers = employeesBySite.get(site.id) ?? [];
    return siteWorkers.some(
      (worker) =>
        matchesWorkerFullName(worker, employeeQuery) && matchesWorkerDni(worker, dniQuery),
    );
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Empleados"
        description="Explorá las carpetas por sede para consultar sus trabajadores, los puestos a su cargo y dar de alta personal individual o por Excel."
        actions={<ButtonLink href="/sedes">Ir a Sedes y Geocercas</ButtonLink>}
      />

      <EmployeeFolderBreadcrumbs />

      <EmployeeSearchBar
        level="root"
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters({})}
      />

      {data.sites.length === 0 ? (
        <EmptyState
          title="Todavía no hay sedes registradas"
          description="Creá una sede en Sedes y Geocercas para organizar las carpetas de empleados."
          action={
            <ButtonLink href="/sedes" className="mt-3">
              Crear sede
            </ButtonLink>
          }
        />
      ) : matchingSites.length === 0 ? (
        <EmptyState
          title="Sin resultados para los filtros aplicados"
          description="Probá ajustando el filtro de sede, nombre y apellido o DNI del trabajador."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matchingSites.map((site) => {
            const siteWorkers = employeesBySite.get(site.id) ?? [];
            const activeWorkers = siteWorkers.filter((worker) => worker.isActive);
            const posts = data.postsBySite[site.id] ?? [];
            const activePosts = posts.filter((post) => post.isActive);
            const matchedWorkers = filteringWorkers
              ? siteWorkers.filter(
                  (worker) =>
                    matchesWorkerFullName(worker, employeeQuery) &&
                    matchesWorkerDni(worker, dniQuery),
                )
              : [];

            return (
              <Card
                key={site.id}
                className="flex flex-col justify-between gap-4 transition-shadow hover:shadow-md"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/empleados/${site.id}`} className="group flex items-start gap-3">
                      <FolderGlyph />
                      <div>
                        <h2 className="text-sm font-bold text-title group-hover:text-brand">
                          {site.name}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted">{site.address}</p>
                      </div>
                    </Link>
                    <Badge tone={site.isActive ? 'success' : 'neutral'}>
                      {site.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                    <span className="rounded-lg bg-alt px-2 py-1 font-medium text-body">
                      {activeWorkers.length}{' '}
                      {activeWorkers.length === 1 ? 'trabajador activo' : 'trabajadores activos'}
                      {siteWorkers.length > activeWorkers.length &&
                        ` (${siteWorkers.length} en total)`}
                    </span>
                    <span className="rounded-lg bg-alt px-2 py-1 font-medium text-body">
                      {activePosts.length}{' '}
                      {activePosts.length === 1 ? 'puesto operativo' : 'puestos operativos'}
                    </span>
                  </div>

                  {matchedWorkers.length > 0 && (
                    <div className="space-y-1 border-t border-line pt-2">
                      <p className="text-[11px] font-semibold text-muted">
                        Trabajadores coincidentes:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {matchedWorkers.slice(0, 4).map((worker) => (
                          <Link
                            key={worker.id}
                            href={`/empleados/${site.id}`}
                            className="rounded-lg border border-line bg-alt px-2 py-1 text-[11px] font-medium text-link hover:border-brand"
                          >
                            {fullName(worker)}
                            {worker.nationalId ? ` · DNI ${worker.nationalId}` : ''}
                          </Link>
                        ))}
                        {matchedWorkers.length > 4 && (
                          <span className="px-1 py-1 text-[11px] text-muted">
                            +{matchedWorkers.length - 4} más
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t border-line pt-3">
                  <ButtonLink href={`/empleados/${site.id}`} variant="secondary">
                    Abrir carpeta
                  </ButtonLink>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
