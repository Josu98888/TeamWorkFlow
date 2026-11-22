'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/Button';
import { CheckField, FormFooter, SelectField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';
import { WEEKDAY_ORDER, WEEKDAY_SHORT_LABELS } from '../labels';
import { computeDurationMinutes, formatEndClock, isOvernightSchedule } from '../turnos-utils';
import type { Employee, ShiftTemplate } from '../types';

type AssignWeeklyWorkerModalProps = {
  siteId: string;
  postId: string;
  postName: string;
  employees: Employee[];
  template?: ShiftTemplate;
  onClose: () => void;
  onSaved: (summary: string) => void;
};

function formatDurationLabel(durationMinutes: number, startTime: string): string {
  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  const parts = [hours > 0 ? `${hours}h` : '', mins > 0 ? `${mins}m` : ''].filter(Boolean).join(' ');
  return isOvernightSchedule(startTime, durationMinutes) ? `${parts} (cruza medianoche)` : parts;
}

/** Create or edit a recurring weekly assignment (`ShiftTemplate`) inside a post folder. */
export function AssignWeeklyWorkerModal({
  siteId,
  postId,
  postName,
  employees,
  template,
  onClose,
  onSaved,
}: AssignWeeklyWorkerModalProps) {
  const [employeeId, setEmployeeId] = useState(template?.employeeId ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(template?.weekdays ?? [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(template?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(
    template ? formatEndClock(template.startTime, template.durationMinutes) : '16:00',
  );
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  const durationMinutes = computeDurationMinutes(startTime, endTime);

  const toggleDay = (day: number) => {
    setLocalError(null);
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day].sort((a, b) => a - b),
    );
  };

  const activeEmployees = employees.filter((emp) => emp.isActive || emp.id === template?.employeeId);
  const employeeOptions = [
    { value: '', label: 'Sin trabajador asignado (puesto vacante)' },
    ...activeEmployees.map((emp) => {
      const sameSite = emp.siteIds.includes(siteId);
      const dniTag = emp.nationalId ? ` · DNI ${emp.nationalId}` : '';
      return {
        value: emp.id,
        label: `${emp.lastName}, ${emp.firstName}${dniTag}${sameSite ? '' : ' (otra sede)'}`,
      };
    }),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (weekdays.length === 0) {
      setLocalError('Seleccioná al menos un día de trabajo de la semana.');
      return;
    }
    setLocalError(null);
    const normalizedEmployee = employeeId.trim() === '' ? null : employeeId;

    const saved = await run(() =>
      template
        ? organizationApi.updateShiftTemplate(template.id, {
            weekdays,
            startTime,
            durationMinutes,
            employeeId: normalizedEmployee,
            isActive,
          })
        : organizationApi.createShiftTemplate({
            siteId,
            postId,
            weekdays,
            startTime,
            durationMinutes,
            employeeId: normalizedEmployee,
          }),
    );

    if (saved) {
      const skippedNote =
        saved.skippedOverlapCount > 0
          ? ` (${saved.skippedOverlapCount} omitidos por superposición de horario)`
          : '';
      onSaved(
        template
          ? `Horario actualizado · ${saved.generatedCount} turnos nuevos generados${skippedNote}.`
          : `Trabajador asignado · ${saved.generatedCount} turnos programados para los próximos días${skippedNote}.`,
      );
    }
  };

  return (
    <Modal title={template ? `Editar horario · ${postName}` : `Asignar trabajador · ${postName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <SelectField label="Trabajador" value={employeeId} onChange={setEmployeeId} options={employeeOptions} />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-body">Días de trabajo de la semana</span>
            <div className="flex gap-1.5">
              <Button variant="ghost" className="px-2 py-1 text-[11px]" onClick={() => setWeekdays([1, 2, 3, 4, 5])}>
                Lun a Vie
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-[11px]"
                onClick={() => setWeekdays([1, 2, 3, 4, 5, 6, 7])}
              >
                Todos
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((day) => {
              const selected = weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDay(day)}
                  className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected
                      ? 'border-brand bg-brand text-white'
                      : 'border-line bg-card text-body hover:bg-alt'
                  }`}
                >
                  {WEEKDAY_SHORT_LABELS[day]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-body">Hora de inicio</span>
            <input
              type="time"
              required
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="field-input"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-body">Hora de fin</span>
            <input
              type="time"
              required
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="field-input"
            />
          </label>
        </div>

        <p className="text-xs text-muted">
          Duración de la jornada: <strong className="text-title">{formatDurationLabel(durationMinutes, startTime)}</strong>
        </p>

        {template && <CheckField label="Asignación semanal activa" checked={isActive} onChange={setIsActive} />}

        <FormFooter
          error={localError ?? error}
          pending={pending}
          submitLabel={template ? 'Guardar cambios' : 'Asignar y generar turnos'}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}
