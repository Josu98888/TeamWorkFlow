'use client';

import { Can } from '@/shared/hooks/useCan';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useResource } from '@/shared/hooks/useResource';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { ProgressBar } from '@/shared/components/ProgressBar';
import { Segmented } from '@/shared/components/Segmented';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { formatMeters, fullName, initials } from '@/shared/lib/format';
import { organizationApi } from '../api';
import type { Site } from '../types';
import { SiteFormModal } from './SiteFormModal';
import { SitesOverviewMap } from './SitesOverviewMap';
import { SiteTilePreview } from './SiteTilePreview';

const FILTERS = ['all', 'active', 'inactive'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS = { all: 'Todas', active: 'Activas', inactive: 'Inactivas' } as const satisfies Record<Filter, string>;

const matches = (site: Site, filter: Filter) =>
  filter === 'all' || (filter === 'active' ? site.isActive : !site.isActive);

const MAX_AVATARS = 3;

export function SitesView() {
  const router = useRouter();
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees);
  const shifts = useResource(organizationApi.listShifts);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const header = (
    <>
      <PageHeader
        title="Sedes y Geocercas"
        description="Ubicaciones, radios de geocerca, puestos, personal y turnos."
        actions={
          <Can capability="sites.manage">
            <Button variant="primary" onClick={() => setCreating(true)}>
              Nueva sede
            </Button>
          </Can>
        }
      />
      {creating && (
        <SiteFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            sites.reload();
          }}
        />
      )}
    </>
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
  const visible = allSites.filter(
    (site) =>
      matches(site, filter) && (!query || `${site.name} ${site.address}`.toLowerCase().includes(query)),
  );

  return (
    <>
      {header}

      {allSites.length > 0 && (
        <Card flush glow="none" className="mb-5">
          <SitesOverviewMap sites={allSites} onSelect={(siteId) => router.push(`/sedes/${siteId}`)} />
        </Card>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          aria-label="Buscar sede"
          placeholder="Buscar por nombre o dirección"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-body outline-none focus-visible:outline-2 focus-visible:outline-brand-medium sm:w-72"
        />
        <Segmented
          label="Estado de la sede"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((option) => ({
            value: option,
            label: FILTER_LABELS[option],
            count: allSites.filter((site) => matches(site, option)).length,
          }))}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No encontramos sedes" description="Probá con otro filtro o búsqueda." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((site) => {
            const staff = allEmployees.filter((employee) => employee.siteIds.includes(site.id));
            const siteShifts = allShifts.filter((shift) => shift.siteId === site.id && shift.status !== 'CANCELLED');
            const live = siteShifts.filter((shift) => shift.status === 'IN_PROGRESS').length;
            const assigned = siteShifts.filter((shift) => shift.employeeId).length;

            return (
              <li key={site.id}>
                <Link
                  href={`/sedes/${site.id}`}
                  className="group block h-full rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
                >
                  <Card flush interactive glow="bottom" className="h-full">
                    <div className="relative">
                      <SiteTilePreview
                        latitude={site.latitude}
                        longitude={site.longitude}
                        radiusMeters={site.geofenceRadiusMeters}
                        isActive={site.isActive}
                      />
                      <div className="absolute left-3 top-3">
                        <Badge tone={site.isActive ? 'success' : 'neutral'}>{site.isActive ? 'Activa' : 'Inactiva'}</Badge>
                      </div>
                    </div>
                    <div className="p-5">
                      <h2 className="truncate text-base font-bold text-title">{site.name}</h2>
                      <p className="mt-0.5 truncate text-xs text-muted">{site.address}</p>
                      <dl className="mt-4 grid grid-cols-3 gap-2">
                        <Stat label="Geocerca" value={formatMeters(site.geofenceRadiusMeters)} />
                        <Stat label="Personal" value={staff.length} />
                        <Stat label="Turnos ahora" value={live} />
                      </dl>
                      {(staff.length > 0 || siteShifts.length > 0) && (
                        <div className="mt-4 flex items-center gap-3">
                          {staff.length > 0 && (
                            <div className="flex shrink-0 items-center -space-x-2">
                              {staff.slice(0, MAX_AVATARS).map((employee) => (
                                <span key={employee.id} className="rounded-full ring-2 ring-card">
                                  <Avatar initials={initials(employee)} label={fullName(employee)} />
                                </span>
                              ))}
                              {staff.length > MAX_AVATARS && (
                                <span className="relative z-10 flex h-8 min-w-8 items-center justify-center rounded-full bg-alt px-1 text-[11px] font-bold text-muted ring-2 ring-card">
                                  +{staff.length - MAX_AVATARS}
                                </span>
                              )}
                            </div>
                          )}
                          {siteShifts.length > 0 && (
                            <div className="min-w-0 flex-1">
                              <ProgressBar
                                label={`Turnos con persona asignada en ${site.name}`}
                                value={assigned}
                                max={siteShifts.length}
                                tone={assigned === siteShifts.length ? 'done' : 'warning'}
                              />
                              <p className="mt-1 text-right text-[11px] text-muted">
                                {assigned} de {siteShifts.length} turnos con persona
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-center text-[11px] text-muted">
        Mapas &copy;{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline"
        >
          OpenStreetMap
        </a>{' '}
        contributors
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-alt/60 px-2.5 py-2">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-title">{value}</dd>
    </div>
  );
}
