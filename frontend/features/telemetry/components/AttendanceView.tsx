'use client';

import { useState } from 'react';
import { organizationApi } from '@/features/organization';
import { Badge } from '@/shared/components/Badge';
import { Button, FilterChip } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { SelectField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime, fullName } from '@/shared/lib/format';
import { telemetryApi } from '../api';
import {
  CLOCK_EVENT_METHOD_LABELS,
  CLOCK_EVENT_TYPE_LABELS,
  WORKDAY_STATUS_LABELS,
  WORKDAY_STATUS_TONES,
} from '../labels';
import { WORKDAY_STATUSES, type ClockEvent, type ListWorkdaysQuery, type Workday } from '../types';
import { CorrectClockEventModal, ManualClockEventModal } from './ClockEventForms';

const TABS = ['events', 'workdays'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS = { events: 'Fichadas', workdays: 'Jornadas' } as const satisfies Record<Tab, string>;

const minutes = (value: number) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')} min`;

export function AttendanceView() {
  const [tab, setTab] = useState<Tab>('events');
  const [siteId, setSiteId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees, { pageSize: 100 });

  const employeeNames = new Map((employees.data?.items ?? []).map((employee) => [employee.id, fullName(employee)]));
  const siteNames = new Map((sites.data?.items ?? []).map((site) => [site.id, site.name]));

  return (
    <>
      <PageHeader title="Asistencia" description="Fichadas, correcciones y jornadas trabajadas." />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((option) => (
          <FilterChip key={option} label={TAB_LABELS[option]} active={tab === option} onSelect={() => setTab(option)} />
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Sede"
          value={siteId}
          onChange={setSiteId}
          options={[{ value: '', label: 'Todas' }, ...(sites.data?.items ?? []).map((site) => ({ value: site.id, label: site.name }))]}
        />
        <SelectField
          label="Empleado"
          value={employeeId}
          onChange={setEmployeeId}
          options={[{ value: '', label: 'Todos' }, ...(employees.data?.items ?? []).map((employee) => ({ value: employee.id, label: fullName(employee) }))]}
        />
      </div>

      {tab === 'events' ? (
        <ClockEventsTab siteId={siteId} employeeId={employeeId} employeeNames={employeeNames} siteNames={siteNames} />
      ) : (
        <WorkdaysTab siteId={siteId} employeeId={employeeId} employeeNames={employeeNames} siteNames={siteNames} />
      )}
    </>
  );
}

type TabProps = {
  siteId: string;
  employeeId: string;
  employeeNames: Map<string, string>;
  siteNames: Map<string, string>;
};

function ClockEventsTab({ siteId, employeeId, employeeNames, siteNames }: TabProps) {
  const events = useResource(telemetryApi.listClockEvents, {
    ...(siteId ? { siteId } : {}),
    ...(employeeId ? { employeeId } : {}),
    pageSize: 100,
  });
  const [manual, setManual] = useState(false);
  const [correcting, setCorrecting] = useState<ClockEvent | null>(null);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setManual(true)}>
          Fichada manual
        </Button>
      </div>
      {manual && (
        <ManualClockEventModal
          onClose={() => setManual(false)}
          onSaved={() => {
            setManual(false);
            events.reload();
          }}
        />
      )}
      {correcting && (
        <CorrectClockEventModal
          event={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            events.reload();
          }}
        />
      )}

      {events.error ? (
        <ErrorState message="No pudimos cargar las fichadas." onRetry={events.reload} />
      ) : !events.data ? (
        <LoadingState rows={2} />
      ) : events.data.items.length === 0 ? (
        <EmptyState title="No hay fichadas" description="Probá con otros filtros o registrá una fichada manual." />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-3">Hora</th>
                  <th scope="col" className="px-5 py-3">Empleado</th>
                  <th scope="col" className="px-5 py-3">Sede</th>
                  <th scope="col" className="px-5 py-3">Tipo</th>
                  <th scope="col" className="px-5 py-3">Origen</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-5 py-3 font-semibold text-title">{formatDateTime(item.deviceTime)}</td>
                    <td className="px-5 py-3 text-body">{employeeNames.get(item.employeeId) ?? 'Empleado'}</td>
                    <td className="px-5 py-3 text-body">{siteNames.get(item.siteId) ?? 'Sede'}</td>
                    <td className="px-5 py-3 text-body">{CLOCK_EVENT_TYPE_LABELS[item.type]}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={item.method === 'MANUAL' ? 'warning' : 'neutral'}>{CLOCK_EVENT_METHOD_LABELS[item.method]}</Badge>
                        {item.outOfGeofence && <Badge tone="danger">Fuera de geocerca</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <Button variant="ghost" onClick={() => setCorrecting(item)}>
                        Corregir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function WorkdaysTab({ siteId, employeeId, employeeNames, siteNames }: TabProps) {
  const [status, setStatus] = useState('');
  const query: ListWorkdaysQuery = {
    ...(siteId ? { siteId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status: status as ListWorkdaysQuery['status'] } : {}),
    pageSize: 100,
  };
  const workdays = useResource(telemetryApi.listWorkdays, query);
  const [detailShiftId, setDetailShiftId] = useState<string | null>(null);

  return (
    <>
      <div className="mb-3 max-w-xs">
        <SelectField
          label="Estado"
          value={status}
          onChange={setStatus}
          options={[{ value: '', label: 'Todos' }, ...WORKDAY_STATUSES.map((value) => ({ value: value.toLowerCase(), label: WORKDAY_STATUS_LABELS[value] }))]}
        />
      </div>
      {detailShiftId && <WorkdayDetailModal shiftId={detailShiftId} onClose={() => setDetailShiftId(null)} />}

      {workdays.error ? (
        <ErrorState message="No pudimos cargar las jornadas." onRetry={workdays.reload} />
      ) : !workdays.data ? (
        <LoadingState rows={2} />
      ) : workdays.data.items.length === 0 ? (
        <EmptyState title="No hay jornadas" description="Las jornadas se generan a partir de las fichadas de cada turno." />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-3">Empleado</th>
                  <th scope="col" className="px-5 py-3">Sede</th>
                  <th scope="col" className="px-5 py-3">Trabajado</th>
                  <th scope="col" className="px-5 py-3">Estado</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workdays.data.items.map((workday) => (
                  <tr key={workday.id}>
                    <td className="px-5 py-3 text-body">{employeeNames.get(workday.employeeId) ?? 'Empleado'}</td>
                    <td className="px-5 py-3 text-body">{siteNames.get(workday.siteId) ?? 'Sede'}</td>
                    <td className="whitespace-nowrap px-5 py-3 font-semibold text-title">{minutes(workday.workedMinutes)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={WORKDAY_STATUS_TONES[workday.status]}>{WORKDAY_STATUS_LABELS[workday.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <Button variant="ghost" onClick={() => setDetailShiftId(workday.shiftId)}>
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/** Workday of one shift (`GET /workdays/:shiftId`). */
function WorkdayDetailModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const workday = useResource(telemetryApi.getWorkday, shiftId);

  return (
    <Modal title="Detalle de la jornada" onClose={onClose}>
      {workday.error ? (
        <ErrorState message="No pudimos cargar la jornada." onRetry={workday.reload} />
      ) : !workday.data ? (
        <p className="text-sm text-muted">Cargando...</p>
      ) : (
        <WorkdayFields workday={workday.data} />
      )}
    </Modal>
  );
}

function WorkdayFields({ workday }: { workday: Workday }) {
  const rows: [string, string][] = [
    ['Estado', WORKDAY_STATUS_LABELS[workday.status]],
    ['Minutos trabajados', minutes(workday.workedMinutes)],
    ['Horas extra', minutes(workday.overtimeMinutes)],
    ['Llegada tarde', minutes(workday.lateMinutes)],
    ['Última actualización', formatDateTime(workday.updatedAt)],
  ];
  return (
    <dl className="space-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
          <dd className="mt-0.5 font-semibold text-title">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
