'use client';

import { Can, useCan } from '@/shared/hooks/useCan';
import { useState } from 'react';
import { useResource } from '@/shared/hooks/useResource';
import { Avatar } from '@/shared/components/Avatar';
import { Badge, type Tone } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { KpiTile } from '@/shared/components/KpiTile';
import { ListRow, RowList } from '@/shared/components/List';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { formatMeters, formatTime, fullName, initials } from '@/shared/lib/format';
import { organizationApi } from '../api';
import { SHIFT_STATUS_LABELS, SHIFT_STATUS_TONES } from '../labels';
import type { Post } from '../types';
import { PostFormModal } from './PostFormModal';
import { SiteFormModal } from './SiteFormModal';
import { SiteMap } from './SiteMap';
import { SiteQrCard } from './SiteQrCard';
import { SiteReportEmailCard } from './SiteReportEmailCard';

const BACK = { href: '/sedes', label: 'Volver a Sedes y Geocercas' } as const;

export function SiteDetailView({ siteId }: { siteId: string }) {
  const site = useResource(organizationApi.getSite, siteId);
  const posts = useResource(organizationApi.listPosts, siteId);
  const employees = useResource(organizationApi.listEmployees, { siteId });
  const shifts = useResource(organizationApi.listShifts, { siteId });
  const canManage = useCan()('sites.manage');
  const [editingSite, setEditingSite] = useState(false);
  // `null` = closed, `'new'` = create, a post = edit.
  const [postForm, setPostForm] = useState<Post | 'new' | null>(null);

  if (site.error) {
    return (
      <>
        <PageHeader title="Sede no encontrada" back={BACK} />
        <ErrorState message="No encontramos esta sede." onRetry={site.reload} />
      </>
    );
  }

  const error = posts.error ?? employees.error ?? shifts.error;
  if (error) {
    return (
      <>
        <PageHeader title="Sede" back={BACK} />
        <ErrorState
          message="No pudimos cargar el detalle de la sede."
          onRetry={() => {
            posts.reload();
            employees.reload();
            shifts.reload();
          }}
        />
      </>
    );
  }

  if (!site.data || !posts.data || !employees.data || !shifts.data) {
    return (
      <>
        <PageHeader title="Cargando sede..." back={BACK} />
        <LoadingState rows={2} />
      </>
    );
  }

  const { data: current } = site;
  const employeeById = new Map(employees.data.items.map((employee) => [employee.id, employee]));
  const postById = new Map(posts.data.items.map((post) => [post.id, post]));
  const allShifts = shifts.data.items;
  const orderedShifts = [...allShifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const activePersonnel = allShifts
    .filter((shift) => shift.status === 'IN_PROGRESS' && shift.employeeId)
    .map((shift) => {
      const person = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
      return person
        ? {
            id: person.id,
            name: fullName(person),
            initials: initials(person),
            postName: postById.get(shift.postId)?.name,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const activePosts = posts.data.items.filter((post) => post.isActive).length;
  const expectedShifts = allShifts.filter((shift) => shift.status !== 'CANCELLED').length;

  return (
    <>
      <PageHeader
        title={current.name}
        back={BACK}
        badge={<Badge tone={current.isActive ? 'success' : 'neutral'}>{current.isActive ? 'Activa' : 'Inactiva'}</Badge>}
        description={`${current.address} · Geocerca de ${formatMeters(current.geofenceRadiusMeters)}`}
        actions={
          <Can capability="sites.manage">
            <Button onClick={() => setEditingSite(true)}>Editar</Button>
            <Button variant="primary" onClick={() => setPostForm('new')}>
              Nuevo puesto
            </Button>
          </Can>
        }
      />
      {editingSite && (
        <SiteFormModal
          site={current}
          onClose={() => setEditingSite(false)}
          onSaved={() => {
            setEditingSite(false);
            site.reload();
          }}
        />
      )}
      {postForm && (
        <PostFormModal
          siteId={siteId}
          post={postForm === 'new' ? undefined : postForm}
          onClose={() => setPostForm(null)}
          onSaved={() => {
            setPostForm(null);
            posts.reload();
          }}
        />
      )}

      <div className="mb-4 grid grid-cols-3 gap-3 sm:gap-4">
        <KpiTile compact label="Presentes" value={activePersonnel.length} secondary={`/${expectedShifts}`} />
        <KpiTile
          compact
          label="Puestos"
          value={activePosts}
          hint={posts.data.total !== activePosts ? `de ${posts.data.total}` : undefined}
        />
        <KpiTile compact label="Turnos de hoy" value={shifts.data.total} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card flush glow="none" className="lg:col-span-2">
          <SiteMap
            siteName={current.name}
            latitude={current.latitude}
            longitude={current.longitude}
            radiusMeters={current.geofenceRadiusMeters}
            isActive={current.isActive}
            activePersonnel={activePersonnel}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Can capability="sites.manage">
            <SiteQrCard site={current} onRotated={site.reload} />
          </Can>

          <Card flush glow="none">
            <div className="px-5 pt-5">
              <SectionLabel>Puestos · {posts.data.total}</SectionLabel>
            </div>
            {posts.data.items.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState title="Esta sede todavía no tiene puestos" />
              </div>
            ) : (
              <RowList variant="lines">
                {posts.data.items.map((post) => {
                  const postShifts = orderedShifts.filter(
                    (shift) => shift.postId === post.id && shift.status !== 'CANCELLED',
                  );
                  const onDuty = postShifts.find((shift) => shift.status === 'IN_PROGRESS' && shift.employeeId);
                  const person = onDuty?.employeeId ? employeeById.get(onDuty.employeeId) : undefined;
                  const schedule = postShifts.length
                    ? postShifts.map((shift) => `${formatTime(shift.startsAt)} a ${formatTime(shift.endsAt)}`).join(' · ')
                    : `mín. ${post.minPeople} ${post.minPeople === 1 ? 'persona' : 'personas'}`;
                  const status: { tone: Tone; label: string } = !post.isActive
                    ? { tone: 'neutral', label: 'Inactivo' }
                    : person
                      ? { tone: 'success', label: 'Cubierto' }
                      : { tone: 'warning', label: 'Sin cubrir' };
                  const content = (
                    <>
                      <p className="truncate text-sm font-semibold text-title">{post.name}</p>
                      <p className="truncate text-xs text-muted">{schedule}</p>
                    </>
                  );
                  return (
                    <ListRow
                      key={post.id}
                      leading={
                        person ? (
                          <Avatar initials={initials(person)} label={fullName(person)} />
                        ) : (
                          <Avatar muted initials="?" label="Sin asignar" />
                        )
                      }
                      trailing={<Badge tone={status.tone}>{status.label}</Badge>}
                    >
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setPostForm(post)}
                          aria-label={`Editar puesto ${post.name}`}
                          className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </ListRow>
                  );
                })}
              </RowList>
            )}
          </Card>
        </div>
      </div>

      <SiteReportEmailCard siteId={siteId} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card flush glow="none">
          <div className="px-5 pt-5">
            <SectionLabel>Personal habilitado · {employees.data.total}</SectionLabel>
          </div>
          {employees.data.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="No hay personal habilitado en esta sede" />
            </div>
          ) : (
            <RowList variant="lines">
              {employees.data.items.map((employee) => (
                <ListRow
                  key={employee.id}
                  leading={<Avatar initials={initials(employee)} label={fullName(employee)} />}
                  trailing={!employee.isActive && <Badge>Inactivo</Badge>}
                >
                  <p className="truncate text-sm font-semibold text-title">{fullName(employee)}</p>
                  <p className="truncate text-xs text-muted">{employee.skills.join(' · ')}</p>
                </ListRow>
              ))}
            </RowList>
          )}
        </Card>

        <Card flush glow="none">
          <div className="px-5 pt-5">
            <SectionLabel>Turnos de hoy · {shifts.data.total}</SectionLabel>
          </div>
          {orderedShifts.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="No hay turnos programados" description="Esta sede no tiene turnos para hoy." />
            </div>
          ) : (
            <RowList variant="lines">
              {orderedShifts.map((shift) => {
                const person = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
                return (
                  <ListRow
                    key={shift.id}
                    leading={
                      person ? (
                        <Avatar initials={initials(person)} label={fullName(person)} />
                      ) : (
                        <Avatar muted initials="?" label="Sin asignar" />
                      )
                    }
                    trailing={<Badge tone={SHIFT_STATUS_TONES[shift.status]}>{SHIFT_STATUS_LABELS[shift.status]}</Badge>}
                  >
                    <p className="truncate text-sm font-semibold text-title">
                      {formatTime(shift.startsAt)} – {formatTime(shift.endsAt)} · {postById.get(shift.postId)?.name ?? 'Puesto'}
                    </p>
                    <p className="truncate text-xs text-muted">{person ? fullName(person) : 'Sin asignar'}</p>
                  </ListRow>
                );
              })}
            </RowList>
          )}
        </Card>
      </div>
    </>
  );
}
