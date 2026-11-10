'use client';

import { useState, type FormEvent } from 'react';
import { organizationApi } from '@/features/organization';
import { FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime, fullName } from '@/shared/lib/format';
import { telemetryApi } from '../api';
import { CLOCK_EVENT_TYPE_LABELS } from '../labels';
import { CLOCK_EVENT_TYPES, type ClockEvent, type ClockEventTypeInput } from '../types';

const TYPE_OPTIONS = CLOCK_EVENT_TYPES.map((type) => ({ value: type.toLowerCase(), label: CLOCK_EVENT_TYPE_LABELS[type] }));

/** `datetime-local` value -> ISO instant (UTC). */
const toIso = (local: string) => new Date(local).toISOString();

/** Manual clock event (supervisor, admin, owner): employee + one of their shifts + type + time + reason. */
export function ManualClockEventModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const employees = useResource(organizationApi.listEmployees, { isActive: true, pageSize: 100 });
  const [employeeId, setEmployeeId] = useState('');
  const effectiveEmployeeId = employeeId || employees.data?.items[0]?.id || '';
  const shifts = useResource(organizationApi.listShifts, { employeeId: effectiveEmployeeId, pageSize: 100 });
  const [shiftId, setShiftId] = useState('');
  const [type, setType] = useState<string>('in');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();

  const shiftItems = effectiveEmployeeId ? (shifts.data?.items ?? []) : [];
  const effectiveShiftId = shiftItems.some((shift) => shift.id === shiftId) ? shiftId : (shiftItems[0]?.id ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(() =>
      telemetryApi.createManualClockEvent({
        employeeId: effectiveEmployeeId,
        shiftId: effectiveShiftId,
        type: type as ClockEventTypeInput,
        time: toIso(time),
        reason: reason.trim(),
      }),
    );
    if (result) onSaved();
  };

  return (
    <Modal title="Fichada manual" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <SelectField
          label="Empleado"
          value={effectiveEmployeeId}
          onChange={setEmployeeId}
          options={(employees.data?.items ?? []).map((employee) => ({ value: employee.id, label: fullName(employee) }))}
        />
        <SelectField
          label="Turno"
          value={effectiveShiftId}
          onChange={setShiftId}
          options={
            shiftItems.length
              ? shiftItems.map((shift) => ({ value: shift.id, label: `${formatDateTime(shift.startsAt)} – ${formatDateTime(shift.endsAt)}` }))
              : [{ value: '', label: 'Sin turnos para este empleado' }]
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Tipo" value={type} onChange={setType} options={TYPE_OPTIONS} />
          <TextField label="Fecha y hora" type="datetime-local" value={time} onChange={setTime} required />
        </div>
        <TextField label="Motivo" value={reason} onChange={setReason} required />
        <FormFooter error={error} pending={pending || !effectiveShiftId} submitLabel="Registrar" onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Correction (PATCH) of a clock event: optional new type/time, mandatory reason. */
export function CorrectClockEventModal({ event: clockEvent, onClose, onSaved }: { event: ClockEvent; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<string>(clockEvent.type.toLowerCase());
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();

  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const result = await run(() =>
      telemetryApi.correctClockEvent(clockEvent.id, {
        ...(type !== clockEvent.type.toLowerCase() ? { type: type as ClockEventTypeInput } : {}),
        ...(time ? { time: toIso(time) } : {}),
        reason: reason.trim(),
      }),
    );
    if (result) onSaved();
  };

  return (
    <Modal title="Corregir fichada" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        Registrada: {CLOCK_EVENT_TYPE_LABELS[clockEvent.type]} · {formatDateTime(clockEvent.deviceTime)}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Tipo" value={type} onChange={setType} options={TYPE_OPTIONS} />
          <TextField label="Nueva fecha y hora" type="datetime-local" value={time} onChange={setTime} hint="Dejalo vacío para mantener la hora." />
        </div>
        <TextField label="Motivo de la corrección" value={reason} onChange={setReason} required />
        <FormFooter error={error} pending={pending} submitLabel="Corregir" onCancel={onClose} />
      </form>
    </Modal>
  );
}
