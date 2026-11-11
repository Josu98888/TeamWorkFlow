'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { CheckField, FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDate } from '@/shared/lib/format';
import { platformBillingApi } from '../api';
import { featureLabel, PLAN_LABELS, SUBSCRIPTION_LABELS, SUBSCRIPTION_TONES } from '../labels';
import { formatMoney, isDecimalAmount } from '../money';
import { PLAN_CODES, type Invoice, type InvoiceQuery, type PageQuery, type Plan, type PlanCode } from '../types';
import { InvoiceModal } from './InvoiceModal';
import { InvoiceTable } from './InvoiceTable';

const PAGE: PageQuery = { page: 1, pageSize: 50 };
const INVOICES: InvoiceQuery = { page: 1, pageSize: 50 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEATURE_KEYS = ['tasks', 'alerts', 'tower'] as const;

/** Edits the price and feature flags of a plan. Core has no plan listing for `platform_admin`, so plans are edited by code. */
function PlanEditor() {
  const [code, setCode] = useState<PlanCode>('basic');
  const [price, setPrice] = useState('');
  const [features, setFeatures] = useState<Record<string, boolean>>({ tasks: false, alerts: false, tower: false });
  const [touchedFeatures, setTouchedFeatures] = useState(false);
  const [updated, setUpdated] = useState<Plan | null>(null);
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const priceText = price.trim();
    const result = await action.run(() => {
      if (priceText && !isDecimalAmount(priceText)) throw new Error('El precio debe ser un número con hasta 2 decimales (por ejemplo 100000.00).');
      return platformBillingApi.updatePlan(code, {
        ...(priceText ? { monthlyPrice: priceText } : {}),
        ...(touchedFeatures ? { features } : {}),
      });
    });
    if (result) setUpdated(result);
  };

  return (
    <Card>
      <SectionLabel>Precios y funciones de los planes</SectionLabel>
      <form onSubmit={submit} className="space-y-3">
        <SelectField label="Plan" value={code} onChange={(value) => setCode(value as PlanCode)} options={PLAN_CODES.map((value) => ({ value, label: PLAN_LABELS[value] }))} />
        <TextField label="Precio mensual (ARS, sin IVA)" value={price} onChange={setPrice} placeholder="100000.00" inputMode="decimal" hint="Aplica desde la próxima factura emitida. Vacío = no cambiar." />
        <div className="space-y-1">
          {FEATURE_KEYS.map((key) => (
            <CheckField
              key={key}
              label={featureLabel(key)}
              checked={features[key] ?? false}
              onChange={(checked) => {
                setTouchedFeatures(true);
                setFeatures((current) => ({ ...current, [key]: checked }));
              }}
            />
          ))}
          <p className="text-[11px] text-muted">Solo se envían las funciones si las modificás.</p>
        </div>
        <FormFooter error={action.error} pending={action.pending} submitLabel="Guardar plan" onCancel={() => setPrice('')} />
      </form>
      {updated && (
        <p role="status" className="mt-3 text-xs text-muted">
          {PLAN_LABELS[updated.code]}: {formatMoney(updated.monthlyPrice)} / mes. Funciones activas:{' '}
          {Object.entries(updated.features).filter(([, on]) => on).map(([key]) => featureLabel(key)).join(', ') || 'ninguna'}.
        </p>
      )}
    </Card>
  );
}

/** Issues the invoice of a tenant for a period (also used to re-issue after voiding). */
function IssueInvoiceForm({ onDone }: { onDone: () => void }) {
  const [tenantId, setTenantId] = useState('');
  const [period, setPeriod] = useState('');
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await action.run(() => {
      if (!UUID.test(tenantId.trim())) throw new Error('El ID de la empresa debe ser un UUID.');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.trim())) throw new Error('El período debe tener el formato AAAA-MM (por ejemplo 2026-10).');
      return platformBillingApi.issueInvoice(tenantId.trim(), period.trim());
    });
    if (result) {
      setPeriod('');
      onDone();
    }
  };

  return (
    <Card>
      <SectionLabel>Emitir factura</SectionLabel>
      <form onSubmit={submit} className="space-y-3">
        <TextField label="ID de la empresa (UUID)" value={tenantId} onChange={setTenantId} required />
        <TextField label="Período (AAAA-MM)" value={period} onChange={setPeriod} placeholder="2026-10" required />
        <FormFooter error={action.error} pending={action.pending} submitLabel="Emitir" onCancel={() => setPeriod('')} />
      </form>
    </Card>
  );
}

type InvoiceDialog = { kind: 'void' | 'receipt' | 'payment'; invoice: Invoice };

/** One modal for the three per-invoice admin writes: void, fiscal receipt number and manual payment. */
function InvoiceAdminModal({ dialog, onClose, onDone }: { dialog: InvoiceDialog; onClose: () => void; onDone: () => void }) {
  const { kind, invoice } = dialog;
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState(invoice.fiscalReceiptNumber ?? '');
  const [amount, setAmount] = useState(invoice.total);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await action.run(() => {
      if (kind === 'void') return platformBillingApi.voidInvoice(invoice.id, reason.trim());
      if (kind === 'receipt') return platformBillingApi.setFiscalReceipt(invoice.id, receipt.trim());
      if (!isDecimalAmount(amount)) throw new Error('El monto debe ser un número con hasta 2 decimales.');
      return platformBillingApi.registerPayment({ invoiceId: invoice.id, amount: amount.trim(), paidAt: new Date(`${paidAt}T12:00:00`).toISOString(), reference: reference.trim() });
    });
    if (result) {
      onDone();
      onClose();
    }
  };

  const title = kind === 'void' ? 'Anular factura' : kind === 'receipt' ? 'Número de comprobante fiscal' : 'Registrar pago manual';
  return (
    <Modal title={`${title} · ${invoice.period}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {kind === 'void' && (
          <>
            <p className="text-xs text-muted">Una factura anulada libera el período: después podés emitir otra con los precios vigentes.</p>
            <TextField label="Motivo" value={reason} onChange={setReason} required />
          </>
        )}
        {kind === 'receipt' && <TextField label="Número de comprobante" value={receipt} onChange={setReceipt} required />}
        {kind === 'payment' && (
          <>
            <p className="text-xs text-muted">
              Total de la factura {formatMoney(invoice.total)}. Solo un pago por el saldo exacto la marca como pagada; otro monto queda en revisión.
            </p>
            <TextField label="Monto (ARS)" value={amount} onChange={setAmount} inputMode="decimal" required />
            <TextField label="Fecha de pago" type="date" value={paidAt} onChange={setPaidAt} required />
            <TextField label="Referencia bancaria" value={reference} onChange={setReference} required />
          </>
        )}
        <FormFooter error={action.error} pending={action.pending} submitLabel="Confirmar" onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Platform billing screen (`platform_admin`): plans, subscriptions and invoices of every tenant. */
export function PlatformBillingView() {
  const subscriptions = useResource(platformBillingApi.listSubscriptions, PAGE);
  const invoices = useResource(platformBillingApi.listInvoices, INVOICES);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [dialog, setDialog] = useState<InvoiceDialog | null>(null);
  const [trialFor, setTrialFor] = useState<string | null>(null);
  const [trialEnd, setTrialEnd] = useState('');
  const trial = useAction();

  const extendTrial = async (event: FormEvent) => {
    event.preventDefault();
    if (!trialFor) return;
    const result = await trial.run(() => platformBillingApi.extendTrial(trialFor, new Date(`${trialEnd}T23:59:59`).toISOString()));
    if (result) {
      setTrialFor(null);
      setTrialEnd('');
      subscriptions.reload();
    }
  };

  return (
    <>
      <PageHeader title="Facturación de la plataforma" description="Planes, suscripciones y facturas de todas las empresas." />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlanEditor />
        <IssueInvoiceForm onDone={invoices.reload} />
      </div>

      <Card flush className="mb-4">
        <div className="px-5 pt-5">
          <SectionLabel>Suscripciones</SectionLabel>
        </div>
        {subscriptions.error ? (
          <div className="p-5"><ErrorState message="No pudimos cargar las suscripciones." onRetry={subscriptions.reload} /></div>
        ) : !subscriptions.data ? (
          <div className="p-5"><LoadingState rows={1} /></div>
        ) : subscriptions.data.items.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState title="No hay suscripciones" /></div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {subscriptions.data.items.map((subscription) => (
              <li key={subscription.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-title">{subscription.tenantId}</p>
                  <p className="text-xs text-muted">
                    Plan {PLAN_LABELS[subscription.plan] ?? subscription.plan}
                    {subscription.trialEndsAt ? ` · prueba hasta ${formatDate(subscription.trialEndsAt)}` : ''}
                    {subscription.cancelAtPeriodEnd ? ' · cancela a fin de mes' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={SUBSCRIPTION_TONES[subscription.status] ?? 'neutral'}>{SUBSCRIPTION_LABELS[subscription.status] ?? subscription.status}</Badge>
                  {subscription.status === 'trial' && <Button onClick={() => setTrialFor(subscription.tenantId)}>Extender prueba</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card flush>
        <div className="px-5 pt-5">
          <SectionLabel>Facturas</SectionLabel>
        </div>
        {invoices.error ? (
          <div className="p-5"><ErrorState message="No pudimos cargar las facturas." onRetry={invoices.reload} /></div>
        ) : !invoices.data ? (
          <div className="p-5"><LoadingState rows={1} /></div>
        ) : invoices.data.items.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState title="No hay facturas" /></div>
        ) : (
          <InvoiceTable
            invoices={invoices.data.items}
            actions={(invoice) => (
              <>
                <Button onClick={() => setDetail(invoice)}>Detalle</Button>
                {invoice.status !== 'void' && <Button onClick={() => setDialog({ kind: 'receipt', invoice })}>Comprobante</Button>}
                {invoice.status === 'issued' && <Button onClick={() => setDialog({ kind: 'payment', invoice })}>Registrar pago</Button>}
                {invoice.status !== 'void' && <Button onClick={() => setDialog({ kind: 'void', invoice })}>Anular</Button>}
              </>
            )}
          />
        )}
      </Card>

      {detail && <InvoiceModal invoice={detail} onClose={() => setDetail(null)} />}
      {dialog && <InvoiceAdminModal dialog={dialog} onClose={() => setDialog(null)} onDone={invoices.reload} />}
      {trialFor && (
        <Modal title="Extender período de prueba" onClose={() => setTrialFor(null)}>
          <form onSubmit={extendTrial} className="space-y-3">
            <p className="break-all font-mono text-xs text-muted">{trialFor}</p>
            <TextField label="Nueva fecha de fin de prueba" type="date" value={trialEnd} onChange={setTrialEnd} required />
            <FormFooter error={trial.error} pending={trial.pending} submitLabel="Extender" onCancel={() => setTrialFor(null)} />
          </form>
        </Modal>
      )}
    </>
  );
}
