'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button, FilterChip } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { CheckField, FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { telemetryApi } from '../api';
import type { EmployeeCompensationView, PostOvertimeRateView } from '../types';

const SUBTABS = ['payroll', 'employee_rates', 'post_rates'] as const;
type SubTab = (typeof SUBTABS)[number];
const SUBTAB_LABELS: Record<SubTab, string> = {
  payroll: 'Liquidación mensual',
  employee_rates: 'Precio por hora / jornada (Empleados)',
  post_rates: 'Precio hora extra (Puestos)',
};

const minutes = (value: number) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')} min`;

/** Report 3 — Monthly Excel Payroll & Compensation Rates Configuration (Plan PRO). */
export function PayrollTab({ siteId, employeeId }: { siteId: string; employeeId: string }) {
  const [subTab, setSubTab] = useState<SubTab>('payroll');
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const query = {
    period,
    ...(siteId ? { siteId } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
  const payroll = useResource(telemetryApi.getMonthlyPayroll, query);
  const excelAction = useAction();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SUBTABS.map((item) => (
          <FilterChip key={item} label={SUBTAB_LABELS[item]} active={subTab === item} onSelect={() => setSubTab(item)} />
        ))}
      </div>

      {subTab === 'employee_rates' ? (
        <EmployeeRatesSection onChanged={payroll.reload} />
      ) : subTab === 'post_rates' ? (
        <PostOvertimeRatesSection onChanged={payroll.reload} />
      ) : (
        <>
          <Card className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-xs">
              <TextField label="Período de liquidación (YYYY-MM)" type="month" value={period} onChange={setPeriod} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={payroll.reload}>
                Recalcular
              </Button>
              <Button
                variant="primary"
                disabled={excelAction.pending || !payroll.data}
                onClick={() => void excelAction.run(() => telemetryApi.downloadMonthlyPayrollExcel(query))}
              >
                {excelAction.pending ? 'Generando Excel...' : 'Descargar Excel (.xlsx)'}
              </Button>
            </div>
          </Card>

          {excelAction.error && (
            <p role="alert" className="text-xs text-danger">
              {excelAction.error}
            </p>
          )}

          {payroll.error ? (
            <ErrorState message={payroll.error.message} onRetry={payroll.reload} />
          ) : !payroll.data ? (
            <LoadingState rows={2} />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Card>
                  <p className="text-xs text-muted">Paga regular total</p>
                  <p className="mt-1 text-lg font-bold text-title">$ {payroll.data.totals.totalRegularPay} ARS</p>
                </Card>
                <Card>
                  <p className="text-xs text-muted">Paga horas extras</p>
                  <p className="mt-1 text-lg font-bold text-title">$ {payroll.data.totals.totalOvertimePay} ARS</p>
                </Card>
                <Card>
                  <p className="text-xs text-muted">Total final a pagar</p>
                  <p className="mt-1 text-lg font-bold text-success">$ {payroll.data.totals.totalPay} ARS</p>
                </Card>
                <Card>
                  <p className="text-xs text-muted">Advertencias de tarifa</p>
                  <p className="mt-1 text-lg font-bold text-warning">{payroll.data.totals.warningsCount}</p>
                </Card>
              </div>

              <Card flush glow="none">
                <div className="border-b border-line px-5 py-3">
                  <h3 className="text-sm font-bold text-title">Cálculo de liquidación por trabajador ({payroll.data.employees.length})</h3>
                </div>
                {payroll.data.employees.length === 0 ? (
                  <div className="p-5">
                    <EmptyState title="No hay trabajadores con turnos en este período" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[56rem] text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          <th className="px-5 py-3">Trabajador</th>
                          <th className="px-5 py-3">Modalidad / Tarifa</th>
                          <th className="px-5 py-3">Asist. / Aus. / Fraud.</th>
                          <th className="px-5 py-3">Regulares / Extras</th>
                          <th className="px-5 py-3">Paga Base</th>
                          <th className="px-5 py-3">Paga Extras</th>
                          <th className="px-5 py-3">Total Final</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {payroll.data.employees.map((emp) => (
                          <tr key={emp.employeeId}>
                            <td className="px-5 py-3">
                              <p className="font-semibold text-title">{emp.fullName}</p>
                              {emp.observations && <p className="text-[11px] text-warning">{emp.observations}</p>}
                            </td>
                            <td className="px-5 py-3 text-xs text-body">
                              {emp.payType === 'HOURLY'
                                ? `Por hora ($ ${emp.baseRateApplied})`
                                : emp.payType === 'PER_SHIFT'
                                  ? `Por jornada ($ ${emp.baseRateApplied})`
                                  : 'Sin configurar'}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-body">
                              {emp.attendedShifts} / {emp.absentCount} / {emp.outOfGeofenceCount}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-body">
                              {minutes(emp.totalRegularMinutes)} · +{minutes(emp.totalOvertimeMinutes)}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-body">$ {emp.regularPay}</td>
                            <td className="px-5 py-3 font-mono text-xs text-body">$ {emp.overtimePay}</td>
                            <td className="px-5 py-3 font-mono text-sm font-bold text-success">$ {emp.totalPay}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeRatesSection({ onChanged }: { onChanged: () => void }) {
  const rates = useResource(telemetryApi.listEmployeeCompensations);
  const [editing, setEditing] = useState<EmployeeCompensationView | null>(null);
  const [payType, setPayType] = useState<'hourly' | 'per_shift'>('hourly');
  const [baseRate, setBaseRate] = useState('');
  const { run, pending, error } = useAction();

  const openEdit = (item: EmployeeCompensationView) => {
    setEditing(item);
    setPayType(item.payType === 'PER_SHIFT' ? 'per_shift' : 'hourly');
    setBaseRate(item.baseRate ?? '4500.00');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const saved = await run(() =>
      telemetryApi.upsertEmployeeCompensation(editing.employeeId, {
        payType,
        baseRate,
      }),
    );
    if (saved) {
      setEditing(null);
      rates.reload();
      onChanged();
    }
  };

  if (rates.error) return <ErrorState message={rates.error.message} onRetry={rates.reload} />;
  if (!rates.data) return <LoadingState rows={2} />;

  return (
    <>
      <Card flush glow="none">
        <div className="border-b border-line px-5 py-3">
          <h3 className="text-sm font-bold text-title">Tarifa por hora o por jornada de cada empleado</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Empleado</th>
                <th className="px-5 py-3">Legajo</th>
                <th className="px-5 py-3">Modalidad</th>
                <th className="px-5 py-3">Tarifa (ARS)</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rates.data.items.map((item) => (
                <tr key={item.employeeId}>
                  <td className="px-5 py-3 font-semibold text-title">
                    {item.lastName}, {item.firstName}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{item.employeeNumber ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge tone={item.payType ? 'info' : 'warning'}>
                      {item.payType === 'HOURLY' ? 'Por hora' : item.payType === 'PER_SHIFT' ? 'Por jornada' : 'Sin configurar'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-title">
                    {item.baseRate ? `$ ${item.baseRate}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="secondary" onClick={() => openEdit(item)}>
                      Configurar tarifa
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Modal title={`Tarifa de ${editing.firstName} ${editing.lastName}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit} className="space-y-3">
            <SelectField
              label="Modalidad de pago"
              value={payType}
              onChange={(val) => setPayType(val as 'hourly' | 'per_shift')}
              options={[
                { value: 'hourly', label: 'Precio por hora trabajada' },
                { value: 'per_shift', label: 'Precio fijo por jornada asistida' },
              ]}
            />
            <TextField
              label="Monto en ARS (ej. 4500.00)"
              value={baseRate}
              onChange={setBaseRate}
              required
            />
            <FormFooter error={error} pending={pending} submitLabel="Guardar tarifa" onCancel={() => setEditing(null)} />
          </form>
        </Modal>
      )}
    </>
  );
}

function PostOvertimeRatesSection({ onChanged }: { onChanged: () => void }) {
  const rates = useResource(telemetryApi.listPostOvertimeRates);
  const [editing, setEditing] = useState<PostOvertimeRateView | null>(null);
  const [overtimeRate, setOvertimeRate] = useState('');
  const { run, pending, error } = useAction();

  const openEdit = (item: PostOvertimeRateView) => {
    setEditing(item);
    setOvertimeRate(item.overtimeHourlyRate ?? '6500.00');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const saved = await run(() =>
      telemetryApi.upsertPostOvertimeRate(editing.postId, {
        overtimeHourlyRate: overtimeRate,
      }),
    );
    if (saved) {
      setEditing(null);
      rates.reload();
      onChanged();
    }
  };

  if (rates.error) return <ErrorState message={rates.error.message} onRetry={rates.reload} />;
  if (!rates.data) return <LoadingState rows={2} />;

  return (
    <>
      <Card flush glow="none">
        <div className="border-b border-line px-5 py-3">
          <h3 className="text-sm font-bold text-title">Precio de la hora extra por puesto de trabajo</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Sede</th>
                <th className="px-5 py-3">Puesto de trabajo</th>
                <th className="px-5 py-3">Precio hora extra (ARS)</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rates.data.items.map((item) => (
                <tr key={item.postId}>
                  <td className="px-5 py-3 text-body">{item.siteName}</td>
                  <td className="px-5 py-3 font-semibold text-title">{item.postName}</td>
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-title">
                    {item.overtimeHourlyRate ? `$ ${item.overtimeHourlyRate}` : 'Sin configurar'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="secondary" onClick={() => openEdit(item)}>
                      Configurar hora extra
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Modal title={`Hora extra en ${editing.postName}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit} className="space-y-3">
            <TextField
              label="Precio por hora extra en ARS (ej. 6750.00)"
              value={overtimeRate}
              onChange={setOvertimeRate}
              required
            />
            <FormFooter error={error} pending={pending} submitLabel="Guardar precio" onCancel={() => setEditing(null)} />
          </form>
        </Modal>
      )}
    </>
  );
}

/** Owner-only section to assign which workers receive/access Daily PDF, Monthly PDF, and Payroll Excel reports. */
export function ReportRecipientsTab() {
  const recipients = useResource(telemetryApi.listReportRecipients);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [receiveDaily, setReceiveDaily] = useState(true);
  const [receiveMonthly, setReceiveMonthly] = useState(true);
  const [receivePayrollExcel, setReceivePayrollExcel] = useState(false);
  const { run, pending, error } = useAction();

  if (recipients.error) {
    return <ErrorState message={recipients.error.message} onRetry={recipients.reload} />;
  }
  if (!recipients.data) return <LoadingState rows={2} />;

  const assignable = recipients.data.assignableEmployees;
  const effectiveUserId = selectedUserId || assignable[0]?.userId || '';

  const handleAssign = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveUserId) return;
    const emp = assignable.find((item) => item.userId === effectiveUserId);
    const saved = await run(() =>
      telemetryApi.upsertReportRecipient(effectiveUserId, {
        employeeId: emp?.employeeId ?? null,
        receiveDaily,
        receiveMonthly,
        receivePayrollExcel,
      }),
    );
    if (saved) recipients.reload();
  };

  const handleRemove = async (userId: string) => {
    await run(() => telemetryApi.removeReportRecipient(userId));
    recipients.reload();
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-bold text-title">Asignar destinatario de informes (Exclusivo Owner)</h3>
        <p className="mt-0.5 text-xs text-muted">
          Los informes PDF y Excel llegan siempre al Owner y a los trabajadores que habilites acá.
        </p>
        <form onSubmit={handleAssign} className="mt-3 space-y-3">
          <SelectField
            label="Trabajador con usuario activo"
            value={effectiveUserId}
            onChange={setSelectedUserId}
            options={
              assignable.length > 0
                ? assignable.map((item) => ({
                    value: item.userId,
                    label: `${item.fullName}${item.employeeNumber ? ` (${item.employeeNumber})` : ''}`,
                  }))
                : [{ value: '', label: 'Sin trabajadores con cuenta vinculada' }]
            }
          />
          <div className="flex flex-wrap gap-4">
            <CheckField label="Informe Diario (PDF)" checked={receiveDaily} onChange={setReceiveDaily} />
            <CheckField label="Informe Mensual (PDF)" checked={receiveMonthly} onChange={setReceiveMonthly} />
            <CheckField label="Liquidación Mensual (Excel PRO)" checked={receivePayrollExcel} onChange={setReceivePayrollExcel} />
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending || !effectiveUserId}>
            {pending ? 'Guardando...' : 'Guardar destinatario'}
          </Button>
        </form>
      </Card>

      <Card flush glow="none">
        <div className="border-b border-line px-5 py-3">
          <h3 className="text-sm font-bold text-title">Trabajadores asignados ({recipients.data.items.length})</h3>
        </div>
        {recipients.data.items.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Solo el Owner recibe los informes actualmente" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-5 py-3">Trabajador</th>
                  <th className="px-5 py-3">Informes habilitados</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recipients.data.items.map((rec) => (
                  <tr key={rec.id}>
                    <td className="px-5 py-3 font-semibold text-title">{rec.employeeName ?? rec.userId}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {rec.receiveDaily && <Badge tone="info">Diario PDF</Badge>}
                        {rec.receiveMonthly && <Badge tone="info">Mensual PDF</Badge>}
                        {rec.receivePayrollExcel && <Badge tone="warning">Excel Liquidación (PRO)</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" disabled={pending} onClick={() => void handleRemove(rec.userId)}>
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
