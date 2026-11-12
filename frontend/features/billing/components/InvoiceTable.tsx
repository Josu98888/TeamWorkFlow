'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/shared/components/Badge';
import { formatDate } from '@/shared/lib/format';
import { INVOICE_LABELS, INVOICE_TONES, PLAN_LABELS } from '../labels';
import { formatMoney } from '../money';
import type { Invoice } from '../types';

/** Invoice rows shared by the tenant and platform screens; `actions` renders the per-row buttons. */
export function InvoiceTable({ invoices, actions }: { invoices: Invoice[]; actions: (invoice: Invoice) => ReactNode }) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-title">
              {invoice.period} · {PLAN_LABELS[invoice.plan] ?? invoice.plan}
            </p>
            <p className="text-xs text-muted">
              Emitida {formatDate(invoice.issuedAt)} · vence {formatDate(invoice.dueDate)}
              {invoice.fiscalReceiptNumber ? ` · comprobante ${invoice.fiscalReceiptNumber}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-title">{formatMoney(invoice.total)}</span>
            <Badge tone={INVOICE_TONES[invoice.status] ?? 'neutral'}>{INVOICE_LABELS[invoice.status] ?? invoice.status}</Badge>
            {actions(invoice)}
          </div>
        </li>
      ))}
    </ul>
  );
}
