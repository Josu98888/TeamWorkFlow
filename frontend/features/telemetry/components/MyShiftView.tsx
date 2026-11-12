'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { organizationApi } from '@/features/organization';
import { SHIFT_STATUS_LABELS } from '@/features/organization/labels';
import type { Shift } from '@/features/organization/types';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { SelectField, TextField } from '@/shared/components/Fields';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime, formatTime } from '@/shared/lib/format';
import { ApiError } from '@/shared/lib/http';
import { telemetryApi } from '../api';
import {
  CLOCK_ERROR_MESSAGES,
  CLOCK_EVENT_METHOD_LABELS,
  CLOCK_EVENT_TYPE_LABELS,
  WORKDAY_STATUS_LABELS,
  WORKDAY_STATUS_TONES,
} from '../labels';
import { CLOCK_EVENT_TYPES, type ClockEvent, type ClockEventType, type ClockEventTypeInput } from '../types';
import { QrScanner, canScanQr } from './QrScanner';

const minutes = (value: number) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')} min`;

function clockErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return (cause.code && CLOCK_ERROR_MESSAGES[cause.code]) || cause.message;
  return cause instanceof Error ? cause.message : 'No se pudo registrar la fichada.';
}

/** Current position via the browser; rejects with Spanish copy. */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tu navegador no permite obtener la ubicación. Ingresá el código QR de la sede.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Necesitamos permiso para usar tu ubicación. Habilitalo en el navegador o usá el código QR.'
              : 'No pudimos obtener tu ubicación. Probá de nuevo o usá el código QR.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  });
}

const isOpen = (shift: Shift) => shift.status === 'IN_PROGRESS' || shift.status === 'SCHEDULED';

/** Employee landing page: clock in/out and own workdays. Employees read no sites, so the site comes from the shift. */
export function MyShiftView() {
  const shifts = useResource(organizationApi.listShifts, { pageSize: 100 });
  const events = useResource(telemetryApi.listClockEvents, { pageSize: 10 });
  const workdays = useResource(telemetryApi.listWorkdays, { pageSize: 10 });

  const reloadAll = () => {
    events.reload();
    workdays.reload();
    shifts.reload();
  };

  const openShifts = (shifts.data?.items ?? []).filter(isOpen).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const shiftById = new Map((shifts.data?.items ?? []).map((shift) => [shift.id, shift]));

  return (
    <>
      <PageHeader title="Mi jornada" description="Fichá tu entrada y salida y revisá tus jornadas." />
      <div className="mx-auto max-w-2xl space-y-4">
        {shifts.error ? (
          <ErrorState message="No pudimos cargar tus turnos." onRetry={shifts.reload} />
        ) : !shifts.data ? (
          <LoadingState rows={1} />
        ) : openShifts.length === 0 ? (
          <EmptyState title="No tenés turnos próximos" description="Cuando te asignen un turno vas a poder fichar desde acá." />
        ) : (
          <ClockCard shifts={openShifts} onDone={reloadAll} />
        )}

        <Card flush>
          <div className="px-5 pt-5">
            <SectionLabel>Mis fichadas</SectionLabel>
          </div>
          {events.error ? (
            <div className="p-5">
              <ErrorState message="No pudimos cargar tus fichadas." onRetry={events.reload} />
            </div>
          ) : !events.data ? (
            <div className="p-5">
              <LoadingState rows={1} />
            </div>
          ) : events.data.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Todavía no fichaste" />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {events.data.items.map((item: ClockEvent) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold text-title">{CLOCK_EVENT_TYPE_LABELS[item.type]}</p>
                    <p className="text-xs text-muted">{formatDateTime(item.deviceTime)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={item.method === 'MANUAL' ? 'warning' : 'neutral'}>{CLOCK_EVENT_METHOD_LABELS[item.method]}</Badge>
                    {item.outOfGeofence && <Badge tone="danger">Fuera de geocerca</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card flush>
          <div className="px-5 pt-5">
            <SectionLabel>Mis jornadas</SectionLabel>
          </div>
          {workdays.error ? (
            <div className="p-5">
              <ErrorState message="No pudimos cargar tus jornadas." onRetry={workdays.reload} />
            </div>
          ) : !workdays.data ? (
            <div className="p-5">
              <LoadingState rows={1} />
            </div>
          ) : workdays.data.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Todavía no tenés jornadas" />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {workdays.data.items.map((workday) => {
                const shift = shiftById.get(workday.shiftId);
                return (
                  <li key={workday.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <div>
                      <p className="text-sm font-semibold text-title">{shift ? formatDateTime(shift.startsAt) : 'Turno'}</p>
                      <p className="text-xs text-muted">
                        Trabajado {minutes(workday.workedMinutes)}
                        {workday.lateMinutes > 0 ? ` · Tarde ${workday.lateMinutes} min` : ''}
                        {workday.overtimeMinutes > 0 ? ` · Extra ${minutes(workday.overtimeMinutes)}` : ''}
                      </p>
                    </div>
                    <Badge tone={WORKDAY_STATUS_TONES[workday.status]}>{WORKDAY_STATUS_LABELS[workday.status]}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ClockCard({ shifts, onDone }: { shifts: Shift[]; onDone: () => void }) {
  const initial = shifts.find((shift) => shift.status === 'IN_PROGRESS') ?? shifts[0];
  const [shiftId, setShiftId] = useState(initial.id);
  const [type, setType] = useState<ClockEventTypeInput>('in');
  const [qrCode, setQrCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, pending, error, clearError } = useAction();

  const shift = shifts.find((item) => item.id === shiftId) ?? initial;

  const handleDetected = useCallback((value: string) => {
    setQrCode(value);
    setScanning(false);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const code = qrCode.trim();
    const result = await run(async () => {
      const position = code ? null : await getPosition();
      try {
        return await telemetryApi.createClockEvent({
          clientEventId: crypto.randomUUID(),
          type,
          method: code ? 'qr' : 'gps',
          siteId: shift.siteId,
          deviceTime: new Date().toISOString(),
          ...(position
            ? { latitude: position.coords.latitude, longitude: position.coords.longitude }
            : { qrCode: code }),
        });
      } catch (cause) {
        throw new Error(clockErrorMessage(cause));
      }
    });
    if (result) {
      setNotice(
        result.outOfGeofence
          ? 'Fichada registrada, pero estás fuera de la geocerca de la sede. Tu supervisor fue notificado.'
          : 'Fichada registrada.',
      );
      setQrCode('');
      onDone();
    }
  };

  const typeLabel = CLOCK_EVENT_TYPE_LABELS[type.toUpperCase() as ClockEventType].toLowerCase();

  return (
    <Card>
      <SectionLabel>Fichar</SectionLabel>
      <form onSubmit={submit} className="space-y-3">
        <SelectField
          label="Turno"
          value={shift.id}
          onChange={setShiftId}
          options={shifts.map((item) => ({
            value: item.id,
            label: `${formatDateTime(item.startsAt)} a ${formatTime(item.endsAt)} · ${SHIFT_STATUS_LABELS[item.status]}`,
          }))}
        />
        <SelectField
          label="Tipo de fichada"
          value={type}
          onChange={(value) => setType(value as ClockEventTypeInput)}
          options={CLOCK_EVENT_TYPES.map((value) => ({ value: value.toLowerCase(), label: CLOCK_EVENT_TYPE_LABELS[value] }))}
        />

        {scanning ? (
          <QrScanner onDetected={handleDetected} onClose={() => setScanning(false)} />
        ) : (
          <>
            <TextField
              label="Código QR de la sede (opcional)"
              hint="Si lo dejás vacío usamos tu ubicación."
              value={qrCode}
              onChange={(value) => {
                setQrCode(value);
                clearError();
              }}
              autoComplete="off"
            />
            {canScanQr() && (
              <Button className="w-full py-2" onClick={() => setScanning(true)}>
                Escanear QR con la cámara
              </Button>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm font-semibold text-title">
            {notice}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full py-3 text-sm" disabled={pending}>
          {pending ? 'Registrando...' : `Registrar ${typeLabel}`}
        </Button>
      </form>
    </Card>
  );
}
