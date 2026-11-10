'use client';

import { Can } from '@/shared/hooks/useCan';
import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { SelectField, TextField } from '@/shared/components/Fields';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime, fullName } from '@/shared/lib/format';
import { organizationApi } from '../api';
import { SHIFT_STATUS_LABELS, SHIFT_STATUS_TONES } from '../labels';
import type { ListShiftsQuery, Shift, ShiftWarning } from '../types';
import { ReassignShiftModal, ShiftFormModal } from './ShiftFormModal';

type Dialog = { kind: 'create' } | { kind: 'edit' | 'reassign'; shift: Shift } | null;

export function ShiftsView() {
  const [siteId, setSiteId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [day, setDay] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);
  const cancelAction = useAction();

  // `day` is read in the site's time zone, so the backend requires `siteId` with it.
  const query: ListShiftsQuery = {
    ...(siteId ? { siteId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(siteId && day ? { day } : {}),
    pageSize: 100,
  };
  const shifts = useResource(organizationApi.listShifts, query);
  const sites = useResource(organizationApi.listSites);
  const employees = useResource(organizationApi.listEmployees, { pageSize: 100 });

  const employeeById = new Map((employees.data?.items ?? []).map((employee) => [employee.id, employee]));
  const siteById = new Map((sites.data?.items ?? []).map((site) => [site.id, site]));
  const siteItems = sites.data?.items;
  const employeeItems = employees.data?.items;
  const ready = !!siteItems && !!employeeItems;

  const saved = (shiftWarnings: ShiftWarning[]) => {
    setDialog(null);
    setWarnings(shiftWarnings);
    shifts.reload();
  };

  const cancel = async (shift: Shift) => {
    if (!window.confirm('¿Cancelar este turno?')) return;
    const result = await cancelAction.run(() => organizationApi.cancelShift(shift.id, { version: shift.version }));
    if (result) {
      setWarnings([]);
      shifts.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Turnos"
        description="Programación de turnos por sede, puesto y empleado."
        actions={
          <Can capability="shifts.manage">
            <Button variant="primary" disabled={!ready} onClick={() => setDialog({ kind: 'create' })}>
              Nuevo turno
            </Button>
          </Can>
        }
      />

      {siteItems && employeeItems && dialog?.kind === 'create' && (
        <ShiftFormModal sites={siteItems} employees={employeeItems} onClose={() => setDialog(null)} onSaved={saved} />
      )}
      {siteItems && employeeItems && dialog?.kind === 'edit' && (
        <ShiftFormModal shift={dialog.shift} sites={siteItems} employees={employeeItems} onClose={() => setDialog(null)} onSaved={saved} />
      )}
      {siteItems && employeeItems && dialog?.kind === 'reassign' && (
        <ReassignShiftModal shift={dialog.shift} employees={employeeItems} onClose={() => setDialog(null)} onSaved={saved} />
      )}

      {warnings.length > 0 && (
        <div role="status" className="mb-4 rounded-lg border border-line bg-alt px-4 py-3 text-xs text-body">
          <p className="mb-1 font-semibold text-title">El turno se guardó con advertencias:</p>
          <ul className="list-disc pl-4">
            {warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}
      {cancelAction.error && (
        <p role="alert" className="mb-4 text-xs text-danger">
          {cancelAction.error}
        </p>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        <TextField label="Día" type="date" value={day} onChange={setDay} disabled={!siteId} hint={siteId ? undefined : 'Elegí una sede para filtrar por día.'} />
      </div>

      {shifts.error ? (
        <ErrorState message="No pudimos cargar los turnos." onRetry={shifts.reload} />
      ) : !shifts.data ? (
        <LoadingState rows={2} />
      ) : shifts.data.items.length === 0 ? (
        <EmptyState title="No hay turnos" description="Probá con otros filtros o creá un turno." />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-3">Horario</th>
                  <th scope="col" className="px-5 py-3">Sede</th>
                  <th scope="col" className="px-5 py-3">Empleado</th>
                  <th scope="col" className="px-5 py-3">Estado</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shifts.data.items.map((shift) => {
                  const person = shift.employeeId ? employeeById.get(shift.employeeId) : undefined;
                  const open = shift.status === 'SCHEDULED' || shift.status === 'IN_PROGRESS';
                  return (
                    <tr key={shift.id}>
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-title">
                        {formatDateTime(shift.startsAt)} – {formatDateTime(shift.endsAt)}
                      </td>
                      <td className="px-5 py-3 text-body">{siteById.get(shift.siteId)?.name ?? 'Sede'}</td>
                      <td className="px-5 py-3 text-body">{person ? fullName(person) : <span className="text-muted">Sin asignar</span>}</td>
                      <td className="px-5 py-3">
                        <Badge tone={SHIFT_STATUS_TONES[shift.status]}>{SHIFT_STATUS_LABELS[shift.status]}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {open && (
                          <Can capability="shifts.manage">
                            <Button variant="ghost" onClick={() => setDialog({ kind: 'edit', shift })}>Editar</Button>
                            <Button variant="ghost" onClick={() => setDialog({ kind: 'reassign', shift })}>Reasignar</Button>
                            <Button variant="ghost" onClick={() => void cancel(shift)} disabled={cancelAction.pending}>Cancelar</Button>
                          </Can>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
