// Operation names of the billing module (AGENTS § NATS Contract).
// In `core` they are in-process facade calls; billing answers no NATS requests.
export const BILLING_PATTERNS = {
  planList: 'billing.plan.list',
  subscriptionGet: 'billing.subscription.get',
  subscriptionChangePlan: 'billing.subscription.change-plan',
  subscriptionCancel: 'billing.subscription.cancel',
  subscriptionCancelUndo: 'billing.subscription.cancel-undo',
  subscriptionResubscribe: 'billing.subscription.resubscribe',
  invoiceList: 'billing.invoice.list',
  invoiceGet: 'billing.invoice.get',
  invoicePaymentLink: 'billing.invoice.payment-link',
  webhookMercadopago: 'billing.webhook.mercadopago',
  adminPlanUpdate: 'billing.admin.plan.update',
  adminSubscriptionList: 'billing.admin.subscription.list',
  adminSubscriptionExtendTrial: 'billing.admin.subscription.extend-trial',
  adminInvoiceList: 'billing.admin.invoice.list',
  adminInvoiceVoid: 'billing.admin.invoice.void',
  adminInvoiceIssue: 'billing.admin.invoice.issue',
  adminInvoiceSetFiscalReceipt: 'billing.admin.invoice.set-fiscal-receipt',
  adminPaymentRegister: 'billing.admin.payment.register',
} as const;

export type BillingPattern =
  (typeof BILLING_PATTERNS)[keyof typeof BILLING_PATTERNS];

export const BILLING_MODULE = 'billing';

// Stream owned by billing (backend STEPS S1.2): captures every emitted subject.
export const BILLING_STREAM = 'BILLING_EVENTS';
export const BILLING_STREAM_SUBJECTS = `t.*.${BILLING_MODULE}.>`;
