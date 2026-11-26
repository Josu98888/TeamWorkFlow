'use client';

import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { TextField } from '@/shared/components/Fields';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { telemetryApi } from '../api';
import { CLOCK_EVENT_METHOD_LABELS, CLOCK_EVENT_TYPE_LABELS } from '../labels';

const minutes = (value: number) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')} min`;

/** Report 1 — Daily attendance report (absent workers + out-of-geofence clock-ins) with PDF download. */
export function DailyReportTab({ siteId }: { siteId: string }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const query = { date, ...(siteId ? { siteId } : {}) };
  const report = useResource(telemetryApi.getDailyReport, query);
  const pdfAction = useAction();

  const data = report.data;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <TextField label="Fecha del informe diario" type="date" value={date} onChange={setDate} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={report.reload}>
            Actualizar
          </Button>
          <Button
            variant="primary"
            disabled={pdfAction.pending || !data}
            onClick={() => void pdfAction.run(() => telemetryApi.downloadDailyReportPdf(query))}
          >
            {pdfAction.pending ? 'Generando PDF...' : 'Descargar PDF diario'}
          </Button>
        </div>
      </Card>

      {pdfAction.error && (
        <p role="alert" className="text-xs text-danger">
          {pdfAction.error}
        </p>
      )}

      {report.error ? (
        <ErrorState message={report.error.message || 'No pudimos cargar el informe diario.'} onRetry={report.reload} />
      ) : !data ? (
        <LoadingState rows={2} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-xs text-muted">Turnos asignados</p>
              <p className="mt-1 text-xl font-bold text-title">{data.summary.totalAssignedShifts}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Presentes</p>
              <p className="mt-1 text-xl font-bold text-success">{data.summary.attendedShifts}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Trabajadores ausentes</p>
              <p className="mt-1 text-xl font-bold text-danger">{data.summary.absentCount}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Fichajes fuera de geocerca</p>
              <p className="mt-1 text-xl font-bold text-danger">{data.summary.outOfGeofenceCount}</p>
            </Card>
          </div>

          <Card flush glow="none">
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-title">Trabajadores ausentes en la jornada ({data.absences.length})</h3>
            </div>
            {data.absences.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Sin ausencias registradas en esta fecha" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="px-5 py-3">Trabajador</th>
                      <th className="px-5 py-3">Legajo</th>
                      <th className="px-5 py-3">Sede / Puesto</th>
                      <th className="px-5 py-3">Horario</th>
                      <th className="px-5 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.absences.map((item) => (
                      <tr key={item.shiftId}>
                        <td className="px-5 py-3 font-semibold text-title">{item.employeeName}</td>
                        <td className="px-5 py-3 font-mono text-xs text-muted">{item.employeeNumber ?? '—'}</td>
                        <td className="px-5 py-3 text-body">
                          {item.siteName} · <span className="text-muted">{item.postName}</span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-body">{item.scheduledWindow}</td>
                        <td className="px-5 py-3">
                          <Badge tone="danger">
                            {item.absenceStatus === 'CONFIRMED_ABSENCE' ? 'Ausencia confirmada' : 'Sin fichar entrada'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card flush glow="none">
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-title">
                Fichajes fuera de la geocerca / fraudulentos ({data.outOfGeofenceEvents.length})
              </h3>
            </div>
            {data.outOfGeofenceEvents.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Sin fichajes fuera de geocerca en esta fecha" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="px-5 py-3">Hora</th>
                      <th className="px-5 py-3">Trabajador</th>
                      <th className="px-5 py-3">Sede / Puesto</th>
                      <th className="px-5 py-3">Tipo</th>
                      <th className="px-5 py-3">Distancia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.outOfGeofenceEvents.map((evt) => (
                      <tr key={evt.clockEventId}>
                        <td className="px-5 py-3 font-mono text-xs font-semibold text-title">{evt.localTime}</td>
                        <td className="px-5 py-3 font-semibold text-title">{evt.employeeName}</td>
                        <td className="px-5 py-3 text-body">
                          {evt.siteName} · <span className="text-muted">{evt.postName}</span>
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone="neutral">
                            {CLOCK_EVENT_TYPE_LABELS[evt.type]} ({CLOCK_EVENT_METHOD_LABELS[evt.method]})
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone="danger">{evt.distanceMeters !== null ? `${evt.distanceMeters} m` : 'Fuera de radio'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Report 2 — Monthly attendance report (attendances, absences, hours, overtime and out-of-geofence per worker). */
export function MonthlyReportTab({ siteId, employeeId }: { siteId: string; employeeId: string }) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const query = {
    period,
    ...(siteId ? { siteId } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
  const report = useResource(telemetryApi.getMonthlyReport, query);
  const pdfAction = useAction();

  const data = report.data;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <TextField label="Período mensual (YYYY-MM)" type="month" value={period} onChange={setPeriod} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={report.reload}>
            Actualizar
          </Button>
          <Button
            variant="primary"
            disabled={pdfAction.pending || !data}
            onClick={() => void pdfAction.run(() => telemetryApi.downloadMonthlyReportPdf(query))}
          >
            {pdfAction.pending ? 'Generando PDF...' : 'Descargar PDF mensual'}
          </Button>
        </div>
      </Card>

      {pdfAction.error && (
        <p role="alert" className="text-xs text-danger">
          {pdfAction.error}
        </p>
      )}

      {report.error ? (
        <ErrorState message={report.error.message || 'No pudimos cargar el informe mensual.'} onRetry={report.reload} />
      ) : !data ? (
        <LoadingState rows={2} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Card>
              <p className="text-xs text-muted">Trabajadores</p>
              <p className="mt-1 text-xl font-bold text-title">{data.summary.employeesCount}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Asistencias</p>
              <p className="mt-1 text-xl font-bold text-success">{data.summary.totalAttendedShifts}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Ausencias</p>
              <p className="mt-1 text-xl font-bold text-danger">{data.summary.totalAbsentShifts}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Fuera de geocerca</p>
              <p className="mt-1 text-xl font-bold text-danger">{data.summary.totalOutOfGeofence}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Horas extras</p>
              <p className="mt-1 text-xl font-bold text-title">{minutes(data.summary.totalOvertimeMinutes)}</p>
            </Card>
          </div>

          <Card flush glow="none">
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-title">Resumen mensual por trabajador ({data.employees.length})</h3>
            </div>
            {data.employees.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No hay registros para este período" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="px-5 py-3">Trabajador</th>
                      <th className="px-5 py-3">Legajo</th>
                      <th className="px-5 py-3">Turnos</th>
                      <th className="px-5 py-3">Asistencias</th>
                      <th className="px-5 py-3">Ausencias</th>
                      <th className="px-5 py-3">Fuera geocerca</th>
                      <th className="px-5 py-3">Horas regulares</th>
                      <th className="px-5 py-3">Horas extras</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.employees.map((emp) => (
                      <tr key={emp.employeeId}>
                        <td className="px-5 py-3 font-semibold text-title">{emp.fullName}</td>
                        <td className="px-5 py-3 font-mono text-xs text-muted">{emp.employeeNumber ?? '—'}</td>
                        <td className="px-5 py-3 font-mono text-xs text-body">{emp.totalAssignedShifts}</td>
                        <td className="px-5 py-3 font-semibold text-success">{emp.attendedShifts}</td>
                        <td className="px-5 py-3">
                          {emp.absentCount > 0 ? <Badge tone="danger">{emp.absentCount}</Badge> : <span className="text-muted">0</span>}
                        </td>
                        <td className="px-5 py-3">
                          {emp.outOfGeofenceCount > 0 ? (
                            <Badge tone="danger">{emp.outOfGeofenceCount}</Badge>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-body">{minutes(emp.totalRegularMinutes)}</td>
                        <td className="px-5 py-3 font-mono text-xs font-semibold text-title">{minutes(emp.totalOvertimeMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
