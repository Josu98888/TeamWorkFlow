'use client';

import { useResource } from '@/shared/hooks/useResource';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Card, SectionLabel } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import {
  formatCoordinates,
  formatDate,
  formatMeters,
  formatTime,
  fullName,
  initials,
} from '@/shared/lib/format';
import { organizationApi } from '../api';
import { SHIFT_STATUS_LABELS, SHIFT_STATUS_TONES } from '../labels';
import { SiteMap } from './SiteMap';

const BACK = { href: '/sedes', label: 'Volver a Sedes y Geocercas' } as const;

/** Keeps the first characters of an opaque code visible and masks the rest. */
const maskCode = (code: string) => `${code.slice(0, 6)}••••••${code.slice(-4)}`;

export function SiteDetailView({ siteId }: { siteId: string }) {
  const site = useResource(organizationApi.getSite, siteId);
  const posts = useResource(organizationApi.listPosts, siteId);
  const employees = useResource(organizationApi.listEmployees, { siteId });
  const shifts = useResource(organizationApi.listShifts, { siteId });

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

  return (
    <>
      <PageHeader
        title={current.name}
        description={current.address}
        back={BACK}
        actions={<Badge tone={current.isActive ? 'success' : 'neutral'}>{current.isActive ? 'Activa' : 'Inactiva'}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card flush className="overflow-hidden lg:col-span-2">
          <SiteMap
            siteName={current.name}
            latitude={current.latitude}
            longitude={current.longitude}
            radiusMeters={current.geofenceRadiusMeters}
          />
        </Card>

        <Card>
          <SectionLabel>Geocerca</SectionLabel>
          <dl className="space-y-3 text-sm">
            <Field label="Radio" value={formatMeters(current.geofenceRadiusMeters)} />
            <Field label="Coordenadas" value={formatCoordinates(current.latitude, current.longitude)} />
            <Field label="Zona horaria" value={current.timezone} />
            {current.qrCode && <Field label="Código QR" value={maskCode(current.qrCode)} mono />}
            {current.qrRotatedAt && <Field label="QR rotado" value={formatDate(current.qrRotatedAt)} />}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card flush>
          <div className="px-5 pt-5">
            <SectionLabel>Puestos · {posts.data.total}</SectionLabel>
          </div>
          {posts.data.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Esta sede todavía no tiene puestos" />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {posts.data.items.map((post) => {
                const onDuty = allShifts.find(
                  (shift) => shift.postId === post.id && shift.status === 'IN_PROGRESS',
                );
                const person = onDuty?.employeeId ? employeeById.get(onDuty.employeeId) : undefined;
                return (
                  <li key={post.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-title">{post.name}</p>
                      <p className="text-xs text-muted">
                        {post.requiredSkills.join(' · ')} · mín. {post.minPeople}{' '}
                        {post.minPeople === 1 ? 'persona' : 'personas'}
                      </p>
                    </div>
                    {person ? (
                      <Badge tone="success">{fullName(person)}</Badge>
                    ) : (
                      <Badge tone="danger">Sin cubrir</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card flush>
          <div className="px-5 pt-5">
            <SectionLabel>Personal habilitado · {employees.data.total}</SectionLabel>
          </div>
          {employees.data.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="No hay personal habilitado en esta sede" />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {employees.data.items.map((employee) => (
                <li key={employee.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar initials={initials(employee)} label={fullName(employee)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-title">{fullName(employee)}</p>
                    <p className="truncate text-xs text-muted">{employee.skills.join(' · ')}</p>
                  </div>
                  {!employee.isActive && <Badge>Inactivo</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card flush className="mt-4">
        <div className="px-5 pt-5">
          <SectionLabel>Turnos de hoy · {shifts.data.total}</SectionLabel>
        </div>
        {orderedShifts.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="No hay turnos programados" description="Esta sede no tiene turnos para hoy." />
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-3">Horario</th>
                  <th scope="col" className="px-5 py-3">Puesto</th>
                  <th scope="col" className="px-5 py-3">Empleado</th>
                  <th scope="col" className="px-5 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orderedShifts.map((shift) => {
                  const person = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
                  return (
                    <tr key={shift.id}>
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-title">
                        {formatTime(shift.startsAt)} – {formatTime(shift.endsAt)}
                      </td>
                      <td className="px-5 py-3 text-body">{postById.get(shift.postId)?.name ?? 'Puesto'}</td>
                      <td className="px-5 py-3 text-body">{person ? fullName(person) : <span className="text-muted">Sin asignar</span>}</td>
                      <td className="px-5 py-3">
                        <Badge tone={SHIFT_STATUS_TONES[shift.status]}>{SHIFT_STATUS_LABELS[shift.status]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`mt-0.5 font-semibold text-title ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
