import {
  BILLING_MODULE,
  BILLING_PATTERNS,
  BILLING_STREAM,
  BILLING_STREAM_SUBJECTS,
} from '../billing.patterns';
import {
  BILLING_EVENTS,
  billingEventSubject,
  notificationSendSubject,
  CONSUMED_BILLING_SUBJECTS,
} from './billing.events';

describe('billing.events & billing.patterns', () => {
  it('defines all 18 facade operation patterns', () => {
    const patterns = Object.values(BILLING_PATTERNS);
    expect(patterns).toHaveLength(18);
    for (const pattern of patterns) {
      expect(pattern.startsWith('billing.')).toBe(true);
    }
    expect(BILLING_PATTERNS.planList).toBe('billing.plan.list');
    expect(BILLING_PATTERNS.subscriptionGet).toBe('billing.subscription.get');
    expect(BILLING_PATTERNS.subscriptionChangePlan).toBe(
      'billing.subscription.change-plan',
    );
    expect(BILLING_PATTERNS.subscriptionCancel).toBe('billing.subscription.cancel');
    expect(BILLING_PATTERNS.subscriptionCancelUndo).toBe(
      'billing.subscription.cancel-undo',
    );
    expect(BILLING_PATTERNS.subscriptionResubscribe).toBe(
      'billing.subscription.resubscribe',
    );
    expect(BILLING_PATTERNS.invoiceList).toBe('billing.invoice.list');
    expect(BILLING_PATTERNS.invoiceGet).toBe('billing.invoice.get');
    expect(BILLING_PATTERNS.invoicePaymentLink).toBe(
      'billing.invoice.payment-link',
    );
    expect(BILLING_PATTERNS.webhookMercadopago).toBe(
      'billing.webhook.mercadopago',
    );
    expect(BILLING_PATTERNS.adminPlanUpdate).toBe('billing.admin.plan.update');
    expect(BILLING_PATTERNS.adminSubscriptionList).toBe(
      'billing.admin.subscription.list',
    );
    expect(BILLING_PATTERNS.adminSubscriptionExtendTrial).toBe(
      'billing.admin.subscription.extend-trial',
    );
    expect(BILLING_PATTERNS.adminInvoiceList).toBe(
      'billing.admin.invoice.list',
    );
    expect(BILLING_PATTERNS.adminInvoiceVoid).toBe(
      'billing.admin.invoice.void',
    );
    expect(BILLING_PATTERNS.adminInvoiceIssue).toBe(
      'billing.admin.invoice.issue',
    );
    expect(BILLING_PATTERNS.adminInvoiceSetFiscalReceipt).toBe(
      'billing.admin.invoice.set-fiscal-receipt',
    );
    expect(BILLING_PATTERNS.adminPaymentRegister).toBe(
      'billing.admin.payment.register',
    );
  });

  it('defines stream and module constants', () => {
    expect(BILLING_MODULE).toBe('billing');
    expect(BILLING_STREAM).toBe('BILLING_EVENTS');
    expect(BILLING_STREAM_SUBJECTS).toBe('t.*.billing.>');
  });

  it('builds domain event subjects and validates tenant id', () => {
    const tenantId = '0199b7e0-0000-7000-8000-000000000001';
    expect(
      billingEventSubject(tenantId, BILLING_EVENTS.subscriptionCreated),
    ).toBe(`t.${tenantId}.billing.subscription_created`);
    expect(
      billingEventSubject(tenantId, BILLING_EVENTS.invoiceIssued),
    ).toBe(`t.${tenantId}.billing.invoice_issued`);

    expect(() =>
      billingEventSubject('tenant.with.dot', BILLING_EVENTS.subscriptionCreated),
    ).toThrow('Invalid tenant id');
    expect(() =>
      billingEventSubject('tenant with space', BILLING_EVENTS.subscriptionCreated),
    ).toThrow('Invalid tenant id');
  });

  it('builds notification send subject', () => {
    const tenantId = '0199b7e0-0000-7000-8000-000000000001';
    expect(notificationSendSubject(tenantId)).toBe(
      `t.${tenantId}.notifications.send`,
    );
  });

  it('defines consumed billing subjects', () => {
    expect(CONSUMED_BILLING_SUBJECTS.authTenantCreated).toBe(
      't.*.auth.tenant_created',
    );
    expect(CONSUMED_BILLING_SUBJECTS.billingDataRetentionExpired).toBe(
      't.*.billing.data_retention_expired',
    );
  });
});
