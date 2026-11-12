import { Inject, Injectable } from '@nestjs/common';
import {
  ForbiddenException,
  InvoiceExistsException,
  InvoiceNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { CLOCK_SERVICE } from '../common/clock.service';
import type { ClockService } from '../common/clock.service';
import { calculateInvoice } from '../domain/money-calculator';
import { BILLING_EVENTS } from '../events/billing.events';
import type { WirePlan } from '../events/billing.events';
import { BillingEventsService } from '../events/billing-events.service';
import { BillingPrismaService } from '../prisma/prisma.service';
import type {
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Payment,
  PlanCode,
} from '../prisma/generated/client';

export interface ServiceActor {
  userId: string;
  tenantId: string | null;
  role: string;
}

export interface InvoiceDto {
  id: string;
  tenantId: string;
  subscriptionId: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  plan: WirePlan;
  billableDays: number;
  daysInPeriod: number;
  subtotal: string;
  vatPercent: string;
  vatAmount: string;
  total: string;
  currency: string;
  status: string;
  issuedAt: string;
  dueDate: string;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByUserId: string | null;
  fiscalReceiptNumber: string | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
  lines?: InvoiceLineDto[];
  payments?: PaymentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineDto {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
}

export interface PaymentDto {
  id: string;
  provider: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: string;
  paidAt: string;
}

@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: BillingPrismaService,
    private readonly events: BillingEventsService,
    @Inject(CLOCK_SERVICE) private readonly clock: ClockService,
  ) {}

  async closeMonth(
    targetPeriod?: string,
    specificTenantId?: string,
  ): Promise<InvoiceDto[]> {
    const now = this.clock.now();
    const period = targetPeriod ?? this.calculatePreviousMonthPeriod(now);
    const { periodStart, periodEnd, daysInPeriod } =
      this.getPeriodDateRange(period);

    const subscriptionWhere: Record<string, unknown> = {};
    if (specificTenantId) {
      subscriptionWhere.tenantId = specificTenantId;
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: subscriptionWhere,
      include: {
        planRef: true,
        nextPlanRef: true,
        planChanges: {
          where: {
            effectiveAt: { gte: periodStart, lte: periodEnd },
          },
        },
      },
    });

    const issuedInvoices: InvoiceDto[] = [];

    for (const sub of subscriptions) {
      const existing = await this.prisma.invoice.findFirst({
        where: {
          tenantId: sub.tenantId,
          period,
          status: { not: 'VOID' },
        },
      });

      if (existing && specificTenantId) {
        throw new InvoiceExistsException();
      }

      // Check if subscription was billable during this period
      const billableDays = this.calculateBillableDays(
        sub,
        periodStart,
        periodEnd,
        daysInPeriod,
      );

      if (!existing && billableDays > 0) {
        // Highest plan active during period
        const highestPlanCode = this.getHighestPlan(sub, sub.planChanges);
        const plan = await this.prisma.plan.findUnique({
          where: { code: highestPlanCode },
        });

        const calculation = calculateInvoice({
          monthlyPrice: plan!.monthlyPrice,
          billableDays,
          daysInPeriod,
          vatPercent: envs.vatPercent,
        });

        const dueDate = new Date(
          now.getTime() + envs.dueDays * 24 * 60 * 60 * 1000,
        );

        const invoice = await this.prisma.$transaction(async (tx) => {
          const inv = await tx.invoice.create({
            data: {
              tenantId: sub.tenantId,
              subscriptionId: sub.id,
              period,
              periodStart,
              periodEnd,
              plan: highestPlanCode,
              billableDays,
              daysInPeriod,
              subtotal: calculation.subtotal,
              vatPercent: envs.vatPercent,
              vatAmount: calculation.vatAmount,
              total: calculation.total,
              currency: 'ARS',
              status: 'ISSUED',
              issuedAt: now,
              dueDate,
              lines: {
                create: [
                  {
                    tenantId: sub.tenantId,
                    kind: 'PLAN',
                    description: `Abono Mensual Plan ${plan!.name} (${period})`,
                    quantity: 1,
                    unitPrice: calculation.planAmount,
                    amount: calculation.planAmount,
                  },
                  {
                    tenantId: sub.tenantId,
                    kind: 'VAT',
                    description: `IVA (${envs.vatPercent}%)`,
                    quantity: 1,
                    unitPrice: calculation.vatAmount,
                    amount: calculation.vatAmount,
                  },
                ],
              },
            },
            include: { lines: true },
          });

          return inv;
        });

        await this.events.publish(sub.tenantId, BILLING_EVENTS.invoiceIssued, {
          invoiceId: invoice.id,
          period: invoice.period,
          total: calculation.total.toFixed(2),
          dueDate: dueDate.toISOString(),
        });

        await this.events.publishNotification(sub.tenantId, {
          recipientUserIds: [], // resolved by notification consumer
          templateCode: 'billing_invoice_issued',
          data: {
            invoiceId: invoice.id,
            total: calculation.total.toFixed(2),
            dueDate: dueDate.toISOString(),
            period,
          },
        });

        issuedInvoices.push(this.mapInvoiceToDto(invoice));
      }

      // Transitions application after invoice generation (S6.2)
      if (sub.nextPlan) {
        const nextPlan = sub.nextPlan;
        const plan = await this.prisma.plan.findUnique({
          where: { code: nextPlan },
        });

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { plan: nextPlan, nextPlan: null },
        });

        await this.events.publish(sub.tenantId, BILLING_EVENTS.planChanged, {
          plan: nextPlan.toLowerCase() as WirePlan,
          features: (plan?.features as Record<string, boolean>) ?? {},
          previousPlan: sub.plan.toLowerCase() as WirePlan,
          effectiveAt: now.toISOString(),
        });
      }

      if (sub.cancelAtPeriodEnd) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'CANCELLED', endedAt: periodEnd },
        });

        await this.events.publish(
          sub.tenantId,
          BILLING_EVENTS.subscriptionCancelled,
          {},
        );
      }
    }

    return issuedInvoices;
  }

  async adminIssueInvoice(
    actor: ServiceActor,
    tenantId: string,
    period: string,
  ): Promise<InvoiceDto> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const invoices = await this.closeMonth(period, tenantId);
    if (invoices.length === 0) {
      const existing = await this.prisma.invoice.findFirst({
        where: { tenantId, period, status: { not: 'VOID' } },
        include: { lines: true, payments: true },
      });
      if (existing) {
        throw new InvoiceExistsException();
      }
      throw new ValidationException([
        {
          field: 'period',
          constraints: [
            'No billable days for this tenant in the requested period',
          ],
        },
      ]);
    }

    return invoices[0];
  }

  async adminVoidInvoice(
    actor: ServiceActor,
    invoiceId: string,
    reason: string,
  ): Promise<InvoiceDto> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    if (!reason || reason.trim().length === 0) {
      throw new ValidationException([
        { field: 'reason', constraints: ['Void reason is mandatory'] },
      ]);
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true, payments: true },
    });

    if (!invoice) {
      throw new InvoiceNotFoundException();
    }

    const now = this.clock.now();
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'VOID',
        voidedAt: now,
        voidReason: reason,
        voidedByUserId: actor.userId,
      },
      include: { lines: true, payments: true },
    });

    return this.mapInvoiceToDto(updated);
  }

  async adminSetFiscalReceipt(
    actor: ServiceActor,
    invoiceId: string,
    receiptNumber: string,
  ): Promise<InvoiceDto> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new InvoiceNotFoundException();
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { fiscalReceiptNumber: receiptNumber },
      include: { lines: true, payments: true },
    });

    return this.mapInvoiceToDto(updated);
  }

  async listInvoices(
    actor: ServiceActor,
    filters?: { tenantId?: string; status?: InvoiceStatus; period?: string },
    page = 1,
    pageSize = 20,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (actor.role === 'platform_admin') {
      if (filters?.tenantId) {
        where.tenantId = filters.tenantId;
      }
    } else {
      if (!actor.tenantId) {
        throw new ForbiddenException();
      }
      where.tenantId = actor.tenantId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.period) {
      where.period = filters.period;
    }

    const skip = (Math.max(page, 1) - 1) * pageSize;
    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { issuedAt: 'desc' },
        include: { lines: true, payments: true },
      }),
    ]);

    return {
      items: items.map((inv) => this.mapInvoiceToDto(inv)),
      total,
    };
  }

  async getInvoice(actor: ServiceActor, invoiceId: string): Promise<InvoiceDto> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true, payments: true },
    });

    if (!invoice) {
      throw new InvoiceNotFoundException();
    }

    if (
      actor.role !== 'platform_admin' &&
      invoice.tenantId !== actor.tenantId
    ) {
      throw new InvoiceNotFoundException();
    }

    return this.mapInvoiceToDto(invoice);
  }

  private calculatePreviousMonthPeriod(now: Date): string {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    if (month === 0) {
      return `${year - 1}-12`;
    }
    const prevMonth = String(month).padStart(2, '0');
    return `${year}-${prevMonth}`;
  }

  private getPeriodDateRange(period: string): {
    periodStart: Date;
    periodEnd: Date;
    daysInPeriod: number;
  } {
    const [yStr, mStr] = period.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10); // 1-based
    const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const periodEnd = new Date(nextMonthStart.getTime() - 1);
    const daysInPeriod = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return { periodStart, periodEnd, daysInPeriod };
  }

  private calculateBillableDays(
    sub: {
      status: string;
      trialEndsAt: Date | null;
      createdAt: Date;
      endedAt: Date | null;
    },
    periodStart: Date,
    periodEnd: Date,
    daysInPeriod: number,
  ): number {
    if (
      sub.status === 'TRIAL' &&
      sub.trialEndsAt &&
      sub.trialEndsAt > periodEnd
    ) {
      return 0;
    }

    let start = periodStart;
    if (sub.trialEndsAt && sub.trialEndsAt > periodStart) {
      start = sub.trialEndsAt;
    } else if (sub.createdAt > periodStart) {
      start = sub.createdAt;
    }

    let end = periodEnd;
    if (sub.endedAt && sub.endedAt < periodEnd) {
      end = sub.endedAt;
    }

    if (start > end) {
      return 0;
    }

    const diffMs = end.getTime() - start.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
    return Math.min(Math.max(days, 0), daysInPeriod);
  }

  private getHighestPlan(
    sub: { plan: PlanCode },
    changes: { fromPlan: PlanCode; toPlan: PlanCode }[],
  ): PlanCode {
    if (sub.plan === 'PRO') return 'PRO';
    for (const change of changes) {
      if (change.fromPlan === 'PRO' || change.toPlan === 'PRO') {
        return 'PRO';
      }
    }
    return sub.plan;
  }

  private mapInvoiceToDto(
    inv: Invoice & { lines?: InvoiceLine[]; payments?: Payment[] },
  ): InvoiceDto {
    return {
      id: inv.id,
      tenantId: inv.tenantId,
      subscriptionId: inv.subscriptionId,
      period: inv.period,
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      plan: inv.plan ? (inv.plan.toLowerCase() as WirePlan) : 'basic',
      billableDays: inv.billableDays,
      daysInPeriod: inv.daysInPeriod,
      subtotal: inv.subtotal ? inv.subtotal.toFixed(2) : '0.00',
      vatPercent: inv.vatPercent ? inv.vatPercent.toFixed(2) : '21.00',
      vatAmount: inv.vatAmount ? inv.vatAmount.toFixed(2) : '0.00',
      total: inv.total ? inv.total.toFixed(2) : '0.00',
      currency: inv.currency,
      status: inv.status.toLowerCase(),
      issuedAt: inv.issuedAt.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      voidedAt: inv.voidedAt ? inv.voidedAt.toISOString() : null,
      voidReason: inv.voidReason,
      voidedByUserId: inv.voidedByUserId,
      fiscalReceiptNumber: inv.fiscalReceiptNumber,
      paymentLinkUrl: inv.paymentLinkUrl,
      paymentLinkExpiresAt: inv.paymentLinkExpiresAt
        ? inv.paymentLinkExpiresAt.toISOString()
        : null,
      lines: inv.lines?.map((line) => ({
        id: line.id,
        kind: line.kind.toLowerCase(),
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toFixed(2),
        amount: line.amount.toFixed(2),
      })),
      payments: inv.payments?.map((payment) => ({
        id: payment.id,
        provider: payment.provider.toLowerCase(),
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        status: payment.status.toLowerCase(),
        paidAt: payment.paidAt.toISOString(),
      })),
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
    };
  }
}
