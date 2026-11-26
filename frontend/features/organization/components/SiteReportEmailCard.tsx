'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  telemetryApi,
  type RequestSiteReportEmailResponse,
  type SiteReportEmailKind,
} from '@/features/telemetry';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { TextField } from '@/shared/components/Fields';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';

export function SiteReportEmailCard({ siteId }: { siteId: string }) {
  const status = useResource(telemetryApi.getSiteReportEmailStatus, siteId);
  const [dailyDate, setDailyDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [monthlyPeriod, setMonthlyPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [lastConfirmation, setLastConfirmation] =
    useState<RequestSiteReportEmailResponse | null>(null);
  const dailyAction = useAction();
  const monthlyPdfAction = useAction();
  const monthlyExcelAction = useAction();

  // While loading or if the actor does not have Owner / site-admin (HR) permission on this site, hide panel.
  if (status.error || !status.data || !status.data.permissions.canAccessPanel) {
    return null;
  }

  const {
    recipientEmailMasked,
    hasProPlan,
    nextAvailableDate,
    permissions,
    requestedToday,
  } = status.data;

  const handleRequest = async (kind: SiteReportEmailKind) => {
    const runner =
      kind === 'daily_absences_pdf'
        ? dailyAction
        : kind === 'monthly_attendance_pdf'
          ? monthlyPdfAction
          : monthlyExcelAction;

    const payload =
      kind === 'daily_absences_pdf'
        ? { kind, date: dailyDate }
        : { kind, period: monthlyPeriod };

    const result = await runner.run(() =>
      telemetryApi.requestSiteReportEmail(siteId, payload),
    );
    if (result) {
      setLastConfirmation(result);
      status.reload();
    }
  };

  const dailyDone = requestedToday.dailyAbsencesPdf.requested;
  const monthlyPdfDone = requestedToday.monthlyAttendancePdf.requested;
  const monthlyExcelDone = requestedToday.monthlyPayrollExcel.requested;
  const activeError =
    dailyAction.error ?? monthlyPdfAction.error ?? monthlyExcelAction.error;

  return (
    <Card flush glow="none" className="mt-4">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionLabel>Envío de Informes por Correo · Sede</SectionLabel>
            <h3 className="mt-1 text-sm font-bold text-title">
              Solicitar informe de faltas diarias e informe mensual a mi correo
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              Disponible para el Owner y personal de la sede con permiso de administrador (RRHH).
              Se envía a{' '}
              <span className="font-semibold text-body">
                {recipientEmailMasked ?? 'tu correo registrado'}
              </span>{' '}
              (máximo 1 solicitud por día para no sobrecargar el servicio).
            </p>
          </div>
          <Badge tone="info">Límite: 1 pedido / día</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
        {permissions.canRequestDaily && (
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-alt/60 p-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-title">
                  1. Informe de Faltas Diarias (PDF)
                </h4>
                <Badge tone={dailyDone ? 'warning' : 'success'}>
                  {dailyDone ? 'Ya solicitado hoy' : 'Disponible hoy'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                Detalle de trabajadores ausentes en la jornada y fichajes fuera de la geocerca de esta sede.
              </p>
              <div className="mt-3 max-w-xs">
                <TextField
                  label="Fecha de la jornada"
                  type="date"
                  value={dailyDate}
                  onChange={setDailyDate}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="primary"
                disabled={dailyDone || dailyAction.pending}
                onClick={() => void handleRequest('daily_absences_pdf')}
              >
                {dailyAction.pending
                  ? 'Enviando a tu correo...'
                  : dailyDone
                    ? 'Informe diario ya enviado hoy'
                    : 'Enviar informe de faltas diarias a mi correo'}
              </Button>
              {dailyDone && (
                <span className="text-[11px] text-muted">
                  {requestedToday.dailyAbsencesPdf.sentAt
                    ? `Enviado: ${formatDateTime(requestedToday.dailyAbsencesPdf.sentAt)} · `
                    : ''}
                  Próximo pedido: {nextAvailableDate}
                </span>
              )}
            </div>
          </div>
        )}

        {(permissions.canRequestMonthly ||
          permissions.canRequestPayrollExcel) && (
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-alt/60 p-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-title">
                  2. Informe Mensual de la Sede (PDF y Excel)
                </h4>
                <Badge
                  tone={
                    monthlyPdfDone && (!hasProPlan || monthlyExcelDone)
                      ? 'warning'
                      : 'success'
                  }
                >
                  {monthlyPdfDone && (!hasProPlan || monthlyExcelDone)
                    ? 'Cupo diario utilizado'
                    : 'Disponible hoy'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                Consolidado mensual de asistencias, ausencias, horas regulares y extras del personal de esta sede.
              </p>
              <div className="mt-3 max-w-xs">
                <TextField
                  label="Período mensual (YYYY-MM)"
                  type="month"
                  value={monthlyPeriod}
                  onChange={setMonthlyPeriod}
                />
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {permissions.canRequestMonthly && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="primary"
                    disabled={monthlyPdfDone || monthlyPdfAction.pending}
                    onClick={() => void handleRequest('monthly_attendance_pdf')}
                  >
                    {monthlyPdfAction.pending
                      ? 'Enviando PDF mensual...'
                      : monthlyPdfDone
                        ? 'Informe mensual (PDF) ya enviado hoy'
                        : 'Enviar informe mensual (PDF) a mi correo'}
                  </Button>
                  {monthlyPdfDone && (
                    <span className="text-[11px] text-muted">
                      Próximo pedido: {nextAvailableDate}
                    </span>
                  )}
                </div>
              )}

              <div className="border-t border-line pt-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={
                        !hasProPlan ||
                        !permissions.canRequestPayrollExcel ||
                        monthlyExcelDone ||
                        monthlyExcelAction.pending
                      }
                      onClick={() =>
                        void handleRequest('monthly_payroll_excel')
                      }
                    >
                      {monthlyExcelAction.pending
                        ? 'Enviando Excel (.xlsx)...'
                        : monthlyExcelDone
                          ? 'Excel mensual ya enviado hoy'
                          : 'Enviar informe mensual en Excel (.xlsx) a mi correo'}
                    </Button>
                    <Badge tone={hasProPlan ? 'info' : 'warning'}>
                      {hasProPlan ? 'Plan PRO activo' : 'Exclusivo Plan PRO'}
                    </Badge>
                  </div>
                  {monthlyExcelDone && (
                    <span className="text-[11px] text-muted">
                      Próximo pedido: {nextAvailableDate}
                    </span>
                  )}
                </div>
                {!hasProPlan && (
                  <p className="mt-1.5 text-[11px] text-muted">
                    La prestación del archivo Excel al pedir el informe mensual está disponible únicamente para cuentas con el mejor plan del servicio (
                    <Link href="/facturacion" className="text-link underline">
                      actualizar a Plan PRO
                    </Link>
                    ).
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {(lastConfirmation || activeError) && (
        <div className="border-t border-line px-5 py-3">
          {activeError ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {activeError}
            </p>
          ) : (
            lastConfirmation && (
              <p role="status" className="text-xs font-semibold text-success">
                Enviamos el informe ({lastConfirmation.targetPeriod}) a{' '}
                {lastConfirmation.sentToEmailMasked}. Podrás volver a solicitarlo el{' '}
                {lastConfirmation.nextAvailableDate}.
              </p>
            )
          )}
        </div>
      )}
    </Card>
  );
}
