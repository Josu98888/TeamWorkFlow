import { USE_MOCKS } from '@/shared/lib/config';
import { billingHttpApi, platformBillingHttpApi } from './http';
import { billingMockApi, platformBillingMockApi } from './mock';
import type {
  Invoice,
  InvoiceQuery,
  Page,
  PageQuery,
  PaymentLink,
  Plan,
  PlanCode,
  RegisterPaymentInput,
  Subscription,
  UpdatePlanInput,
} from './types';

/** Contract of the tenant billing screen (owner/admin of the tenant). */
export type BillingApi = {
  listPlans: () => Promise<Plan[]>;
  getSubscription: () => Promise<Subscription>;
  changePlan: (plan: PlanCode) => Promise<Subscription>;
  cancelSubscription: () => Promise<Subscription>;
  undoCancel: () => Promise<Subscription>;
  resubscribe: (plan: PlanCode) => Promise<Subscription>;
  listInvoices: (query: InvoiceQuery) => Promise<Page<Invoice>>;
  getInvoice: (invoiceId: string) => Promise<Invoice>;
  createPaymentLink: (invoiceId: string) => Promise<PaymentLink>;
};

/** Contract of the platform billing screen (`platform_admin`, `/billing/admin/*`). */
export type PlatformBillingApi = {
  /** Core has no plan listing for `platform_admin`; the admin edits a plan by code. */
  updatePlan: (plan: PlanCode, input: UpdatePlanInput) => Promise<Plan>;
  listSubscriptions: (query: PageQuery) => Promise<Page<Subscription>>;
  extendTrial: (tenantId: string, trialEndsAt: string) => Promise<Subscription>;
  listInvoices: (query: InvoiceQuery) => Promise<Page<Invoice>>;
  issueInvoice: (tenantId: string, period: string) => Promise<Invoice>;
  voidInvoice: (invoiceId: string, reason: string) => Promise<Invoice>;
  setFiscalReceipt: (invoiceId: string, receiptNumber: string) => Promise<Invoice>;
  registerPayment: (input: RegisterPaymentInput) => Promise<{ id: string; status: string }>;
};

export const billingApi: BillingApi = USE_MOCKS ? billingMockApi : billingHttpApi;
export const platformBillingApi: PlatformBillingApi = USE_MOCKS ? platformBillingMockApi : platformBillingHttpApi;
