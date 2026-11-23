'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import {
  fetchAllEmployees,
  fetchAllPostsForSite,
  fetchAllSites,
  fetchAllTemplates,
  matchesEmployeeDni,
  matchesEmployeeName,
  matchesText,
  type TurnosSearchFilters,
} from '../turnos-utils';
import type { Employee, Post, ShiftTemplate, Site } from '../types';
import { ShiftFolderBreadcrumbs } from './ShiftFolderBreadcrumbs';
import { ShiftSearchBar } from './ShiftSearchBar';

type RootTurnosData = {
  sites: Site[];
  postsBySite: Record<string, Post[]>;
  employees: Employee[];
  templates: ShiftTemplate[];
};

async function loadRootTurnosData(): Promise<RootTurnosData> {
  const [sites, employees, templates] = await Promise.all([
    fetchAllSites(),
    fetchAllEmployees(),
    fetchAllTemplates(),
  ]);
  const entries = await Promise.all(
    sites.map(async (site) => [site.id, await fetchAllPostsForSite(site.id)] as const),
  );
  return {
    sites,
    postsBySite: Object.fromEntries(entries),
    employees,
    templates,
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
 * Level 0 of `/turnos`: folder view by Site (`Sede`), with the 4-field search bar
 * (`Sede`, `Puesto de trabajo`, `Empleado`, `DNI`).
 */
export function ShiftsRootView() {
  const { data, error, isLoading, reload } = useResource(loadRootTurnosData);
  const [filters, setFilters] = useState<TurnosSearchFilters>({});

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message={error?.message ?? 'No se pudieron cargar las sedes y turnos.'} onRetry={reload} />;
  }

  const employeeById = new Map(data.employees.map((emp) => [emp.id, emp]));
  const siteQuery = filters.siteQuery ?? '';
  const postQuery = filters.postQuery ?? '';
  const empQuery = filters.employeeQuery ?? '';
  const dniQuery = filters.dniQuery ?? '';
  const filteringEmployees = empQuery.trim().length > 0 || dniQuery.trim().length > 0;
  const filteringDeeper = filteringEmployees || postQuery.trim().length > 0;

  const matchingSites = data.sites.filter((site) => {
    const siteMatches = matchesText(site.name, siteQuery) || matchesText(site.address, siteQuery);
    if (!siteMatches) return false;
    if (!filteringDeeper) return true;

    const sitePosts = data.postsBySite[site.id] ?? [];
    const matchingPosts = sitePosts.filter((post) => {
      if (!matchesText(post.name, postQuery)) return false;
      if (!filteringEmployees) return true;
      return data.templates.some((tpl) => {
        if (tpl.postId !== post.id || !tpl.isActive) return false;
        const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
        return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
      });
    });

    return matchingPosts.length > 0;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Turnos"
        description="Explorá las carpetas por sede para abrir sus puestos de trabajo y gestionar los horarios semanales."
        actions={<ButtonLink href="/sedes">Ir a Sedes y Geocercas</ButtonLink>}
      />

      <ShiftFolderBreadcrumbs />

      <ShiftSearchBar level="root" filters={filters} onChange={setFilters} onClear={() => setFilters({})} />

      {data.sites.length === 0 ? (
        <EmptyState
          title="Todavía no hay sedes registradas"
          description="Creá una sede y sus puestos en Sedes y Geocercas para organizar los turnos."
          action={
            <ButtonLink href="/sedes" className="mt-3">
              Crear sede
            </ButtonLink>
          }
        />
      ) : matchingSites.length === 0 ? (
        <EmptyState
          title="Sin resultados para los filtros aplicados"
          description="Probá ajustando la búsqueda de sede, puesto, empleado o DNI."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matchingSites.map((site) => {
            const posts = data.postsBySite[site.id] ?? [];
            const activePosts = posts.filter((post) => post.isActive);
            const activeTemplates = data.templates.filter((tpl) => tpl.siteId === site.id && tpl.isActive);
            const matchedPosts = filteringDeeper
              ? posts.filter((post) => {
                  if (!matchesText(post.name, postQuery)) return false;
                  if (!filteringEmployees) return true;
                  return activeTemplates.some((tpl) => {
                    if (tpl.postId !== post.id) return false;
                    const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
                    return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
                  });
                })
              : [];

            return (
              <Card key={site.id} className="flex flex-col justify-between gap-4 transition-shadow hover:shadow-md">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/turnos/${site.id}`} className="group flex items-start gap-3">
                      <FolderGlyph />
                      <div>
                        <h2 className="text-sm font-bold text-title group-hover:text-brand">{site.name}</h2>
                        <p className="mt-0.5 text-xs text-muted">{site.address}</p>
                      </div>
                    </Link>
                    <Badge tone={site.isActive ? 'success' : 'neutral'}>
                      {site.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                    <span className="rounded-lg bg-alt px-2 py-1 font-medium text-body">
                      {activePosts.length} {activePosts.length === 1 ? 'puesto activo' : 'puestos activos'}
                    </span>
                    <span className="rounded-lg bg-alt px-2 py-1 font-medium text-body">
                      {activeTemplates.length}{' '}
                      {activeTemplates.length === 1 ? 'trabajador asignado' : 'trabajadores asignados'}
                    </span>
                  </div>

                  {matchedPosts.length > 0 && (
                    <div className="space-y-1 border-t border-line pt-2">
                      <p className="text-[11px] font-semibold text-muted">Coincidencias en puestos:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {matchedPosts.slice(0, 4).map((post) => (
                          <Link
                            key={post.id}
                            href={`/turnos/${site.id}/${post.id}`}
                            className="rounded-lg border border-line bg-alt px-2 py-1 text-[11px] font-medium text-link hover:border-brand"
                          >
                            {post.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t border-line pt-3">
                  <ButtonLink href={`/turnos/${site.id}`} variant="secondary">
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
