// Types mirroring the billing DTOs of `core` (`backend/core/src/billing/**`). Served under `/api/v1/billing`.
// MONEY: every amount is a decimal STRING ("121000.00", currency ARS). Never parse it for arithmetic;
// format it for display only (`formatMoney`).

export type PlanCode = 'basic' | 'pro';
export const PLAN_CODES: readonly PlanCode[] = ['basic', 'pro'];

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type InvoiceStatus = 'issued' | 'paid' | 'void';

export type Plan = {
  code: PlanCode;
  name: string;
  monthlyPrice: string;
  features: Record<string, boolean>;
  isActive: boolean;
};

export type Subscription = {
  id: string;
  tenantId: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  nextPlan: PlanCode | null;
  cancelAtPeriodEnd: boolean;
  features: Record<string, boolean>;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceLine = {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
};

export type Payment = {
  id: string;
  provider: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: string;
  paidAt: string;
};

export type Invoice = {
  id: string;
  tenantId: string;
  subscriptionId: string;
  /** Calendar month, `YYYY-MM`. */
  period: string;
  periodStart: string;
  periodEnd: string;
  plan: PlanCode;
  billableDays: number;
  daysInPeriod: number;
  subtotal: string;
  vatPercent: string;
  vatAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByUserId: string | null;
  fiscalReceiptNumber: string | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
  lines?: InvoiceLine[];
  payments?: Payment[];
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = { items: T[]; total: number };

export type InvoiceQuery = { status?: InvoiceStatus; period?: string; page?: number; pageSize?: number };
export type PageQuery = { page?: number; pageSize?: number };
export type PaymentLink = { url: string; expiresAt: string };

export type UpdatePlanInput = { monthlyPrice?: string; features?: Record<string, boolean> };
export type RegisterPaymentInput = { invoiceId: string; amount: string; paidAt: string; reference: string };
