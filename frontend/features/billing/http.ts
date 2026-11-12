import { apiFetch } from '@/shared/lib/http';
import type { BillingApi, PlatformBillingApi } from './api';
import type { InvoiceQuery, PageQuery } from './types';

const post = <T>(path: string, body: unknown = {}) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

const invoiceQuery = ({ status, period, page, pageSize }: InvoiceQuery) => qs({ status: status?.toUpperCase(), period, page, pageSize });
const pageQuery = ({ page, pageSize }: PageQuery) => qs({ page, pageSize });

/** Real implementation against `core` (`/api/v1/billing/...`), owner/admin of the tenant. */
export const billingHttpApi: BillingApi = {
  listPlans: () => apiFetch('/billing/plans'),
  getSubscription: () => apiFetch('/billing/subscription'),
  changePlan: (plan) => post('/billing/subscription/change-plan', { plan }),
  cancelSubscription: () => post('/billing/subscription/cancel'),
  undoCancel: () => post('/billing/subscription/cancel-undo'),
  resubscribe: (plan) => post('/billing/subscription/resubscribe', { plan }),
  listInvoices: (query) => apiFetch(`/billing/invoices${invoiceQuery(query)}`),
  getInvoice: (invoiceId) => apiFetch(`/billing/invoices/${invoiceId}`),
  createPaymentLink: (invoiceId) => post(`/billing/invoices/${invoiceId}/payment-link`),
};

/** Real implementation against `core` (`/api/v1/billing/admin/...`), `platform_admin` only. */
export const platformBillingHttpApi: PlatformBillingApi = {
  updatePlan: (plan, input) => put(`/billing/admin/plans/${plan}`, input),
  listSubscriptions: (query) => apiFetch(`/billing/admin/subscriptions${pageQuery(query)}`),
  extendTrial: (tenantId, trialEndsAt) => post(`/billing/admin/subscriptions/${tenantId}/extend-trial`, { trialEndsAt }),
  listInvoices: (query) => apiFetch(`/billing/admin/invoices${invoiceQuery(query)}`),
  issueInvoice: (tenantId, period) => post('/billing/admin/invoices', { tenantId, period }),
  voidInvoice: (invoiceId, reason) => post(`/billing/admin/invoices/${invoiceId}/void`, { reason }),
  setFiscalReceipt: (invoiceId, receiptNumber) => put(`/billing/admin/invoices/${invoiceId}/fiscal-receipt`, { receiptNumber }),
  registerPayment: (input) => post('/billing/admin/payments', input),
};
