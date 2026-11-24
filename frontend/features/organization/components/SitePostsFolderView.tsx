'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { organizationApi } from '../api';
import {
  fetchAllEmployees,
  fetchAllPostsForSite,
  fetchAllTemplates,
  matchesEmployeeDni,
  matchesEmployeeName,
  matchesText,
  type TurnosSearchFilters,
} from '../turnos-utils';
import type { Employee, Post, ShiftTemplate, Site } from '../types';
import { ShiftFolderBreadcrumbs } from './ShiftFolderBreadcrumbs';
import { ShiftSearchBar } from './ShiftSearchBar';

type SitePostsData = {
  site: Site;
  posts: Post[];
  employees: Employee[];
  templates: ShiftTemplate[];
};

async function loadSitePostsData(siteId: string): Promise<SitePostsData> {
  const [site, posts, employees, templates] = await Promise.all([
    organizationApi.getSite(siteId),
    fetchAllPostsForSite(siteId),
    fetchAllEmployees(),
    fetchAllTemplates({ siteId }),
  ]);
  return { site, posts, employees, templates };
}

function PostFolderGlyph() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M3 6a2 2 0 0 1 2-2h4.2c.6 0 1.2.28 1.6.76L12 6.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    </span>
  );
}

/**
 * Level 1 of `/turnos/[siteId]`: folder per Post (`Puesto`) configured in that site,
 * with the 3-field search bar (`Puesto de trabajo`, `Empleado`, `DNI`).
 */
export function SitePostsFolderView({ siteId }: { siteId: string }) {
  const { data, error, isLoading, reload } = useResource(loadSitePostsData, siteId);
  const [filters, setFilters] = useState<TurnosSearchFilters>({});

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message={error?.message ?? 'No se pudieron cargar los puestos de la sede.'} onRetry={reload} />;
  }

  const employeeById = new Map(data.employees.map((emp) => [emp.id, emp]));
  const postQuery = filters.postQuery ?? '';
  const empQuery = filters.employeeQuery ?? '';
  const dniQuery = filters.dniQuery ?? '';
  const filteringEmployees = empQuery.trim().length > 0 || dniQuery.trim().length > 0;

  const matchingPosts = data.posts.filter((post) => {
    if (!matchesText(post.name, postQuery)) return false;
    if (!filteringEmployees) return true;
    return data.templates.some((tpl) => {
      if (tpl.postId !== post.id || !tpl.isActive) return false;
      const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
      return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
    });
  });

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/turnos', label: 'Volver a sedes' }}
        title={data.site.name}
        description={`Puestos de trabajo de ${data.site.name} (${data.site.timezone}).`}
        badge={<Badge tone={data.site.isActive ? 'success' : 'neutral'}>{data.site.isActive ? 'Sede activa' : 'Sede inactiva'}</Badge>}
        actions={<ButtonLink href={`/sedes/${siteId}`}>Administrar puestos en Sedes</ButtonLink>}
      />

      <ShiftFolderBreadcrumbs site={{ id: data.site.id, name: data.site.name }} />

      <ShiftSearchBar level="site" filters={filters} onChange={setFilters} onClear={() => setFilters({})} />

      {data.posts.length === 0 ? (
        <EmptyState
          title="Esta sede todavía no tiene puestos creados"
          description="Creá los puestos de trabajo desde la pestaña de Sedes y Geocercas."
          action={
            <ButtonLink href={`/sedes/${siteId}`} className="mt-3">
              Configurar puestos
            </ButtonLink>
          }
        />
      ) : matchingPosts.length === 0 ? (
        <EmptyState
          title="Sin puestos coincidentes"
          description="Ajustá el nombre del puesto, empleado o DNI."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matchingPosts.map((post) => {
            const postTemplates = data.templates.filter((tpl) => tpl.postId === post.id && tpl.isActive);
            const matchedTemplates = filteringEmployees
              ? postTemplates.filter((tpl) => {
                  const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
                  return matchesEmployeeName(emp, empQuery) && matchesEmployeeDni(emp, dniQuery);
                })
              : postTemplates;

            return (
              <Card key={post.id} className="flex flex-col justify-between gap-4 transition-shadow hover:shadow-md">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/turnos/${siteId}/${post.id}`} className="group flex items-start gap-3">
                      <PostFolderGlyph />
                      <div>
                        <h2 className="text-sm font-bold text-title group-hover:text-brand">{post.name}</h2>
                        <p className="mt-0.5 text-xs text-muted">
                          Mínimo requerido: {post.minPeople} {post.minPeople === 1 ? 'persona' : 'personas'}
                        </p>
                      </div>
                    </Link>
                    <Badge tone={post.isActive ? 'success' : 'neutral'}>
                      {post.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </div>

                  {post.requiredSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {post.requiredSkills.map((skill) => (
                        <span key={skill} className="rounded-full bg-alt px-2 py-0.5 text-[11px] font-medium text-muted">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-body">
                    <span className="font-semibold text-title">{postTemplates.length}</span>{' '}
                    {postTemplates.length === 1 ? 'trabajador asignado' : 'trabajadores asignados'}
                  </div>

                  {filteringEmployees && matchedTemplates.length > 0 && (
                    <div className="space-y-1 border-t border-line pt-2 text-[11px] text-muted">
                      <p className="font-semibold">Personal coincidente:</p>
                      <ul className="space-y-0.5 text-body">
                        {matchedTemplates.slice(0, 3).map((tpl) => {
                          const emp = tpl.employeeId ? employeeById.get(tpl.employeeId) : undefined;
                          return (
                            <li key={tpl.id}>
                              {emp ? `${emp.lastName}, ${emp.firstName}` : 'Sin asignar'}
                              {emp?.nationalId ? ` · DNI ${emp.nationalId}` : ''}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t border-line pt-3">
                  <ButtonLink href={`/turnos/${siteId}/${post.id}`} variant="secondary">
                    Abrir puesto
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
