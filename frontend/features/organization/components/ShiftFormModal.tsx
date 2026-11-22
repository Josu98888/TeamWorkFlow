'use client';

import { useState, type FormEvent } from 'react';
import { FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { fullName } from '@/shared/lib/format';
import { organizationApi } from '../api';
import type { Employee, Shift, ShiftWarning, Site } from '../types';

/** ISO instant -> value of an `<input type="datetime-local">` (browser local time). */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
/** `datetime-local` value -> ISO instant with offset (the DTO requires one). */
const toIso = (local: string) => new Date(local).toISOString();

type Props = {
  /** Existing shift to edit; omitted to create. */
  shift?: Shift;
  sites: Site[];
  employees: Employee[];
  onClose: () => void;
  onSaved: (warnings: ShiftWarning[]) => void;
};

/** Create (no `shift`) or edit a shift (times and post; the site never changes). */
export function ShiftFormModal({ shift, sites, employees, onClose, onSaved }: Props) {
  const [siteId, setSiteId] = useState(shift?.siteId ?? sites[0]?.id ?? '');
  const [postId, setPostId] = useState(shift?.postId ?? '');
  const [startsAt, setStartsAt] = useState(shift ? toLocalInput(shift.startsAt) : '');
  const [endsAt, setEndsAt] = useState(shift ? toLocalInput(shift.endsAt) : '');
  const [employeeId, setEmployeeId] = useState(shift?.employeeId ?? '');
  const posts = useResource(organizationApi.listPosts, siteId);
  const { run, pending, error } = useAction();

  const siteEmployees = employees.filter((employee) => employee.isActive && employee.siteIds.includes(siteId));
  const postOptions = (posts.data?.items ?? []).filter((post) => post.isActive);
  const effectivePostId = postOptions.some((post) => post.id === postId) ? postId : (postOptions[0]?.id ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(() =>
      shift
        ? organizationApi.updateShift(shift.id, {
            version: shift.version,
            startsAt: toIso(startsAt),
            endsAt: toIso(endsAt),
            postId: effectivePostId,
          })
        : organizationApi.createShift({
            siteId,
            postId: effectivePostId,
            startsAt: toIso(startsAt),
            endsAt: toIso(endsAt),
            employeeId: employeeId || null,
          }),
    );
    if (result) onSaved(result.warnings);
  };

  return (
    <Modal title={shift ? 'Editar turno' : 'Nuevo turno'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <SelectField
          label="Sede"
          value={siteId}
          onChange={(value) => {
            setSiteId(value);
            setEmployeeId('');
          }}
          disabled={!!shift}
          options={sites.map((site) => ({ value: site.id, label: site.name }))}
        />
        <SelectField
          label="Puesto"
          value={effectivePostId}
          onChange={setPostId}
          options={postOptions.length ? postOptions.map((post) => ({ value: post.id, label: post.name })) : [{ value: '', label: 'Cargando puestos...' }]}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Inicio" type="datetime-local" value={startsAt} onChange={setStartsAt} required />
          <TextField label="Fin" type="datetime-local" value={endsAt} onChange={setEndsAt} required />
        </div>
        {!shift && (
          <SelectField
            label="Empleado (opcional)"
            value={employeeId}
            onChange={setEmployeeId}
            options={[{ value: '', label: 'Sin asignar' }, ...siteEmployees.map((employee) => ({ value: employee.id, label: fullName(employee) }))]}
          />
        )}
        <FormFooter error={error} pending={pending} submitLabel={shift ? 'Guardar' : 'Crear turno'} onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Reassign (or unassign) the employee of a shift. */
export function ReassignShiftModal({
  shift,
  employees,
  onClose,
  onSaved,
}: {
  shift: Shift;
  employees: Employee[];
  onClose: () => void;
  onSaved: (warnings: ShiftWarning[]) => void;
}) {
  const [employeeId, setEmployeeId] = useState(shift.employeeId ?? '');
  const { run, pending, error } = useAction();
  const candidates = employees.filter((employee) => employee.isActive && employee.siteIds.includes(shift.siteId));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(() =>
      organizationApi.reassignShift(shift.id, { version: shift.version, employeeId: employeeId || null }),
    );
    if (result) onSaved(result.warnings);
  };

  return (
    <Modal title="Reasignar turno" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <SelectField
          label="Empleado"
          value={employeeId}
          onChange={setEmployeeId}
          options={[{ value: '', label: 'Sin asignar' }, ...candidates.map((employee) => ({ value: employee.id, label: fullName(employee) }))]}
        />
        <FormFooter error={error} pending={pending} submitLabel="Reasignar" onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Assign or clear authorized overtime minutes (`0..720`) on a shift (`POST /shifts/:shiftId/overtime`). */
export function AssignOvertimeModal({
  shift,
  onClose,
  onSaved,
}: {
  shift: Shift;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [minutesText, setMinutesText] = useState(String(shift.authorizedOvertimeMinutes ?? 0));
  const [reason, setReason] = useState(shift.overtimeReason ?? '');
  const { run, pending, error } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedMinutes = Math.max(0, Math.min(720, Number.parseInt(minutesText || '0', 10) || 0));
    const result = await run(() =>
      organizationApi.assignShiftOvertime(shift.id, {
        version: shift.version,
        authorizedOvertimeMinutes: parsedMinutes,
        reason: reason.trim() ? reason.trim() : null,
      }),
    );
    if (result) onSaved();
  };

  return (
    <Modal title="Asignar horas extra al turno" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {[0, 30, 60, 120, 180, 240].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setMinutesText(String(preset))}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                Number(minutesText) === preset
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-alt text-body hover:text-title'
              }`}
            >
              {preset === 0 ? 'Sin extra (0m)' : `+${preset >= 60 ? `${preset / 60}h` : `${preset}m`}`}
            </button>
          ))}
        </div>
        <TextField
          label="Minutos de horas extra autorizadas (0 a 720)"
          type="number"
          min={0}
          max={720}
          step={15}
          value={minutesText}
          onChange={setMinutesText}
          hint="Permite que el trabajador fiche salida después del horario de fin del turno y liquida hasta este tope al precio de hora extra del puesto."
          required
        />
        <TextField
          label="Motivo (opcional)"
          value={reason}
          onChange={setReason}
          maxLength={300}
          placeholder="Ej. Extensión de jornada por evento / relevo demorado"
        />
        <FormFooter error={error} pending={pending} submitLabel="Guardar horas extra" onCancel={onClose} />
      </form>
    </Modal>
  );
}
