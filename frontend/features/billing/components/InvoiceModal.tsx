'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { INVOICE_LABELS, INVOICE_TONES } from '../labels';
import { formatMoney } from '../money';
import type { Invoice } from '../types';

/** Invoice detail: lines, VAT, payments and, when set, the void reason. */
export function InvoiceModal({ invoice, footer, onClose }: { invoice: Invoice; footer?: ReactNode; onClose: () => void }) {
  return (
    <Modal title={`Factura ${invoice.period}`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={INVOICE_TONES[invoice.status] ?? 'neutral'}>{INVOICE_LABELS[invoice.status] ?? invoice.status}</Badge>
        <span className="text-xs text-muted">
          Emitida {formatDate(invoice.issuedAt)} · vence {formatDate(invoice.dueDate)}
          {invoice.paidAt ? ` · pagada ${formatDateTime(invoice.paidAt)}` : ''}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted">
        {invoice.billableDays} de {invoice.daysInPeriod} días facturables.
        {invoice.fiscalReceiptNumber ? ` Comprobante fiscal ${invoice.fiscalReceiptNumber}.` : ''}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {(invoice.lines ?? []).map((line) => (
            <tr key={line.id} className="border-b border-line">
              <td className="py-2 text-body">{line.description}</td>
              <td className="py-2 text-right text-body">{formatMoney(line.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-semibold text-title">Total ({invoice.currency})</td>
            <td className="pt-2 text-right font-semibold text-title">{formatMoney(invoice.total)}</td>
          </tr>
        </tbody>
      </table>
      {invoice.voidReason && <p className="mt-3 text-xs text-danger">Anulada: {invoice.voidReason}</p>}
      {(invoice.payments ?? []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Pagos</h3>
          <ul className="space-y-1 text-xs text-body">
            {(invoice.payments ?? []).map((payment) => (
              <li key={payment.id}>
                {formatMoney(payment.amount)} · {payment.provider} · {payment.status} · {formatDateTime(payment.paidAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {footer}
        <Button variant="primary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  );
}
