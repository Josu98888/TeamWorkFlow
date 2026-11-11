'use client';

import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { billingApi } from '../api';
import { featureLabel, PLAN_LABELS } from '../labels';
import { formatMoney } from '../money';
import type { Invoice, InvoiceQuery } from '../types';
import { InvoiceModal } from './InvoiceModal';
import { InvoiceTable } from './InvoiceTable';
import { SubscriptionPanel } from './SubscriptionPanel';

const FIRST_PAGE: InvoiceQuery = { page: 1, pageSize: 20 };

/** Tenant billing screen (owner/admin): plan, subscription, invoices and payment links. */
export function BillingView() {
  const subscription = useResource(billingApi.getSubscription);
  const plans = useResource(billingApi.listPlans);
  const invoices = useResource(billingApi.listInvoices, FIRST_PAGE);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const detail = useAction();
  const pay = useAction();

  const open = async (invoiceId: string) => {
    const invoice = await detail.run(() => billingApi.getInvoice(invoiceId));
    if (invoice) setSelected(invoice);
  };

  const payInvoice = async (invoiceId: string) => {
    const result = await pay.run(() => billingApi.createPaymentLink(invoiceId));
    if (!result) return;
    setLink(result);
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const reload = () => {
    subscription.reload();
    plans.reload();
    invoices.reload();
  };

  return (
    <>
      <PageHeader title="Facturación" description="Tu plan, la suscripción y las facturas de la empresa (en pesos argentinos)." />

      {subscription.error ? (
        <ErrorState message={subscription.error.message || 'No pudimos cargar la suscripción.'} onRetry={subscription.reload} />
      ) : !subscription.data ? (
        <LoadingState rows={1} />
      ) : (
        <SubscriptionPanel subscription={subscription.data} onChanged={reload} />
      )}

      <Card className="mb-4">
        <SectionLabel>Planes</SectionLabel>
        {plans.error ? (
          <p className="text-xs text-muted">No pudimos cargar el catálogo de planes.</p>
        ) : !plans.data ? (
          <p className="text-xs text-muted">Cargando planes...</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {plans.data.map((plan) => (
              <div key={plan.code} className="rounded-lg border border-line p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-title">{PLAN_LABELS[plan.code] ?? plan.name}</span>
                  {subscription.data?.plan === plan.code && <Badge tone="info">Plan actual</Badge>}
                </div>
                <p className="mt-1 text-lg font-bold text-title">
                  {formatMoney(plan.monthlyPrice)} <span className="text-xs font-normal text-muted">/ mes + IVA</span>
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-muted">
                  <li>Sedes, empleados, turnos y asistencia</li>
                  {Object.entries(plan.features).map(([key, enabled]) => (
                    <li key={key} className={enabled ? 'text-body' : 'line-through'}>
                      {featureLabel(key)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card flush>
        <div className="px-5 pt-5">
          <SectionLabel>Facturas</SectionLabel>
        </div>
        {invoices.error ? (
          <div className="p-5">
            <ErrorState message="No pudimos cargar las facturas." onRetry={invoices.reload} />
          </div>
        ) : !invoices.data ? (
          <div className="p-5">
            <LoadingState rows={1} />
          </div>
        ) : invoices.data.items.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="Todavía no hay facturas" description="La primera se emite al cierre del primer mes facturable." />
          </div>
        ) : (
          <InvoiceTable
            invoices={invoices.data.items}
            actions={(invoice) => (
              <>
                <Button disabled={detail.pending} onClick={() => void open(invoice.id)}>
                  Ver detalle
                </Button>
                {invoice.status === 'issued' && (
                  <Button variant="primary" disabled={pay.pending} onClick={() => void payInvoice(invoice.id)}>
                    Pagar
                  </Button>
                )}
              </>
            )}
          />
        )}
        {(detail.error || pay.error) && (
          <p role="alert" className="px-5 pb-4 text-xs text-danger">
            {detail.error ?? pay.error}
          </p>
        )}
        {link && (
          <p className="px-5 pb-4 text-xs text-muted">
            Enlace de pago generado (vence {formatDateTime(link.expiresAt)}). Si no se abrió,{' '}
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline">
              abrilo acá
            </a>
            .
          </p>
        )}
      </Card>

      {selected && (
        <InvoiceModal
          invoice={selected}
          onClose={() => setSelected(null)}
          footer={
            selected.status === 'issued' ? (
              <Button variant="primary" disabled={pay.pending} onClick={() => void payInvoice(selected.id)}>
                Pagar
              </Button>
            ) : null
          }
        />
      )}
    </>
  );
}
