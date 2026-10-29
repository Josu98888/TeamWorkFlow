'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useResource } from '@/shared/hooks/useResource';
import { Badge } from '@/shared/components/Badge';
import { FilterChip } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { formatMeters } from '@/shared/lib/format';
import { organizationApi } from '../api';
import type { Site } from '../types';
import { SiteMap } from './SiteMap';

const FILTERS = ['all', 'active', 'inactive'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS = { all: 'Todas', active: 'Activas', inactive: 'Inactivas' } as const satisfies Record<Filter, string>;

const matches = (site: Site, filter: Filter) =>
  filter === 'all' || (filter === 'active' ? site.isActive : !site.isActive);

export function SitesView() {
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);
  const shifts = useResource(organizationApi.listShifts);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const header = (
    <PageHeader title="Sedes y Geocercas" description="Ubicaciones, radios de geocerca, puestos, personal y turnos." />
  );

  if (sites.error || employees.error || shifts.error) {
    return (
      <>
        {header}
        <ErrorState
          message="No pudimos cargar las sedes."
          onRetry={() => {
            sites.reload();
            employees.reload();
            shifts.reload();
          }}
        />
      </>
    );
  }

  if (!sites.data || !employees.data || !shifts.data) {
    return (
      <>
        {header}
        <LoadingState rows={2} />
      </>
    );
  }

  const allSites = sites.data.items;
  const allEmployees = employees.data.items;
  const allShifts = shifts.data.items;
  const query = search.trim().toLowerCase();
  const visible = sites.data.items.filter(
    (site) =>
      matches(site, filter) && (!query || `${site.name} ${site.address}`.toLowerCase().includes(query)),
  );

  return (
    <>
      {header}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <FilterChip
              key={option}
              label={FILTER_LABELS[option]}
              count={allSites.filter((site) => matches(site, option)).length}
              active={filter === option}
              onSelect={() => setFilter(option)}
            />
          ))}
        </div>
        <input
          type="search"
          aria-label="Buscar sede"
          placeholder="Buscar por nombre o dirección"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm text-body outline-none focus-visible:outline-2 focus-visible:outline-brand-medium sm:w-72"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No encontramos sedes" description="Probá con otro filtro o búsqueda." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((site) => {
            const staff = allEmployees.filter((employee) => employee.siteIds.includes(site.id)).length;
            const live = allShifts.filter(
              (shift) => shift.siteId === site.id && shift.status === 'IN_PROGRESS',
            ).length;

            return (
              <li key={site.id}>
                <Link
                  href={`/sedes/${site.id}`}
                  className="group block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
                >
                  <Card flush className="h-full overflow-hidden transition-colors group-hover:bg-alt">
                    <SiteMap
                      compact
                      siteName={site.name}
                      latitude={site.latitude}
                      longitude={site.longitude}
                      radiusMeters={site.geofenceRadiusMeters}
                    />
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-base font-bold text-title">{site.name}</h2>
                        <Badge tone={site.isActive ? 'success' : 'neutral'}>{site.isActive ? 'Activa' : 'Inactiva'}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{site.address}</p>
                      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
                        <Stat label="Geocerca" value={formatMeters(site.geofenceRadiusMeters)} />
                        <Stat label="Personal" value={staff} />
                        <Stat label="Turnos en curso" value={live} />
                      </dl>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-title">{value}</dd>
    </div>
  );
}
