import { minutesFromNow, mockResponse, mockUnavailable } from '@/shared/lib/mock';
import type { BillingApi, PlatformBillingApi } from './api';
import type { Invoice, Plan, Subscription } from './types';

const TENANT = '00000000-0000-4000-8000-0000000000aa';

const PLANS: Plan[] = [
  { code: 'basic', name: 'Básico', monthlyPrice: '100000.00', features: { tasks: false, alerts: false, tower: false }, isActive: true },
  { code: 'pro', name: 'Pro', monthlyPrice: '180000.00', features: { tasks: true, alerts: true, tower: true }, isActive: true },
];

const SUBSCRIPTION: Subscription = {
  id: '00000000-0000-4000-8000-0000000000b1',
  tenantId: TENANT,
  plan: 'pro',
  status: 'trial',
  trialEndsAt: minutesFromNow(60 * 24 * 9),
  nextPlan: null,
  cancelAtPeriodEnd: false,
  features: PLANS[1].features,
  endedAt: null,
  createdAt: minutesFromNow(-60 * 24 * 5),
  updatedAt: minutesFromNow(-60 * 24 * 5),
};

const INVOICE: Invoice = {
  id: '00000000-0000-4000-8000-0000000000c1',
  tenantId: TENANT,
  subscriptionId: SUBSCRIPTION.id,
  period: '2026-10',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-10-31T23:59:59.000Z',
  plan: 'pro',
  billableDays: 31,
  daysInPeriod: 31,
  subtotal: '180000.00',
  vatPercent: '21.00',
  vatAmount: '37800.00',
  total: '217800.00',
  currency: 'ARS',
  status: 'issued',
  issuedAt: minutesFromNow(-60 * 24 * 9),
  dueDate: minutesFromNow(60 * 24),
  paidAt: null,
  voidedAt: null,
  voidReason: null,
  voidedByUserId: null,
  fiscalReceiptNumber: null,
  paymentLinkUrl: null,
  paymentLinkExpiresAt: null,
  lines: [
    { id: 'l1', kind: 'plan', description: 'Plan Pro, octubre 2026', quantity: 1, unitPrice: '180000.00', amount: '180000.00' },
    { id: 'l2', kind: 'vat', description: 'IVA 21%', quantity: 1, unitPrice: '37800.00', amount: '37800.00' },
  ],
  payments: [],
  createdAt: minutesFromNow(-60 * 24 * 9),
  updatedAt: minutesFromNow(-60 * 24 * 9),
};

/** Demo data; every write is unavailable (mock mode is read-only). */
export const billingMockApi: BillingApi = {
  listPlans: () => mockResponse(PLANS),
  getSubscription: () => mockResponse(SUBSCRIPTION),
  changePlan: mockUnavailable,
  cancelSubscription: mockUnavailable,
  undoCancel: mockUnavailable,
  resubscribe: mockUnavailable,
  listInvoices: () => mockResponse({ items: [INVOICE], total: 1 }),
  getInvoice: () => mockResponse(INVOICE),
  createPaymentLink: mockUnavailable,
};

export const platformBillingMockApi: PlatformBillingApi = {
  updatePlan: mockUnavailable,
  listSubscriptions: () => mockResponse({ items: [SUBSCRIPTION], total: 1 }),
  extendTrial: mockUnavailable,
  listInvoices: () => mockResponse({ items: [INVOICE], total: 1 }),
  issueInvoice: mockUnavailable,
  voidInvoice: mockUnavailable,
  setFiscalReceipt: mockUnavailable,
  registerPayment: mockUnavailable,
};
