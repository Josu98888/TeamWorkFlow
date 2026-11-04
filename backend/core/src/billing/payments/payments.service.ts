import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import {
  ForbiddenException,
  InvalidWebhookSignatureException,
  InvoiceNotFoundException,
  InvoiceNotPayableException,
} from '../../common/exceptions/app.exceptions';
import { CLOCK_SERVICE } from '../common/clock.service';
import type { ClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { BillingEventsService } from '../events/billing-events.service';
import { BillingPrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type {
  PaymentProvider,
  ProviderPaymentDetails,
} from './payment-provider.interface';

export interface ServiceActor {
  userId: string;
  tenantId: string | null;
  role: string;
}

export interface RegisterPaymentInput {
  invoiceId: string;
  amount: string | Decimal | number;
  paidAt: Date | string;
  reference: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: BillingPrismaService,
    private readonly events: BillingEventsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CLOCK_SERVICE) private readonly clock: ClockService,
  ) {}

  async getPaymentLink(
    actor: ServiceActor,
    invoiceId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new InvoiceNotFoundException();
    }

    if (actor.role !== 'platform_admin' && invoice.tenantId !== actor.tenantId) {
      throw new InvoiceNotFoundException();
    }

    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new InvoiceNotPayableException();
    }

    const now = this.clock.now();
    if (
      invoice.paymentLinkUrl &&
      invoice.paymentLinkExpiresAt &&
      invoice.paymentLinkExpiresAt > now
    ) {
      return {
        url: invoice.paymentLinkUrl,
        expiresAt: invoice.paymentLinkExpiresAt.toISOString(),
      };
    }

    const { url, expiresAt } = await this.provider.createPaymentLink(invoice);

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentLinkUrl: url,
        paymentLinkExpiresAt: expiresAt,
      },
    });

    return {
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async handleWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): Promise<{ ok: boolean }> {
    const validation = await this.provider.validateWebhook(headers, rawBody);
    if (!validation.isValid) {
      throw new InvalidWebhookSignatureException();
    }

    const existingNotif = await this.prisma.webhookNotification.findUnique({
      where: { notificationId: validation.notificationId },
    });

    if (existingNotif) {
      return { ok: true };
    }

    await this.prisma.webhookNotification.create({
      data: {
        notificationId: validation.notificationId,
        result: 'processed',
      },
    });

    if (!validation.paymentId) {
      return { ok: true };
    }

    const paymentDetails = await this.provider.getPayment(validation.paymentId);
    await this.processPaymentDetails('MERCADOPAGO', paymentDetails);

    return { ok: true };
  }

  async adminRegisterPayment(
    actor: ServiceActor,
    input: RegisterPaymentInput,
  ): Promise<{ id: string; status: string }> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: input.invoiceId },
    });

    if (!invoice) {
      throw new InvoiceNotFoundException();
    }

    const paidDate =
      typeof input.paidAt === 'string' ? new Date(input.paidAt) : input.paidAt;
    const amountDec = new Decimal(input.amount);
    const isValidAmount = amountDec.equals(invoice.total);
    const paymentStatus = isValidAmount ? 'APPROVED' : 'NEEDS_REVIEW';

    const payment = await this.prisma.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        provider: 'MANUAL',
        providerPaymentId: input.reference,
        amount: amountDec,
        currency: 'ARS',
        status: paymentStatus,
        registeredByUserId: actor.userId,
        paidAt: paidDate,
      },
    });

    if (isValidAmount) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
          paidAt: paidDate,
        },
      });

      await this.checkReactivationAndEmit(invoice.tenantId, invoice.id);
    }

    return { id: payment.id, status: paymentStatus.toLowerCase() };
  }

  async reconcileUnpaidInvoices(): Promise<number> {
    const issuedInvoices = await this.prisma.invoice.findMany({
      where: { status: 'ISSUED' },
    });

    let reconciledCount = 0;
    for (const inv of issuedInvoices) {
      try {
        const payments = await this.provider.searchPaymentsByReference(inv.id);
        for (const payment of payments) {
          if (payment.status === 'approved') {
            await this.processPaymentDetails('MERCADOPAGO', payment);
            reconciledCount++;
          }
        }
      } catch (err) {
        this.logger.error(`Failed to reconcile invoice ${inv.id}`, err);
      }
    }

    return reconciledCount;
  }

  private async processPaymentDetails(
    providerType: 'MERCADOPAGO' | 'MANUAL',
    details: ProviderPaymentDetails,
  ) {
    const existing = await this.prisma.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: providerType,
          providerPaymentId: details.id,
        },
      },
    });

    if (existing) {
      return;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: details.externalReference },
    });

    if (!invoice) {
      this.logger.warn(
        `Received payment for unknown invoice reference ${details.externalReference}`,
      );
      return;
    }

    const amountDec = new Decimal(details.amount);
    const isApproved =
      details.status === 'approved' &&
      details.currency === 'ARS' &&
      amountDec.equals(invoice.total);

    const paymentStatus = isApproved ? 'APPROVED' : 'NEEDS_REVIEW';

    await this.prisma.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        provider: providerType,
        providerPaymentId: details.id,
        amount: amountDec,
        currency: details.currency,
        status: paymentStatus,
        paidAt: details.paidAt,
      },
    });

    if (isApproved) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
          paidAt: details.paidAt,
        },
      });

      await this.checkReactivationAndEmit(invoice.tenantId, invoice.id);
    }
  }

  private async checkReactivationAndEmit(tenantId: string, invoiceId: string) {
    const now = this.clock.now();
    const otherOverdue = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        status: 'ISSUED',
        dueDate: { lt: now },
      },
    });

    // Emitted ONLY when no other overdue unpaid invoices remain
    if (!otherOverdue) {
      await this.events.publish(tenantId, BILLING_EVENTS.paymentReceived, {
        invoiceId,
      });

      // Reactivate subscription if PAST_DUE or SUSPENDED
      const sub = await this.prisma.subscription.findFirst({
        where: {
          tenantId,
          status: { in: ['PAST_DUE', 'SUSPENDED'] },
        },
      });

      if (sub) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'ACTIVE' },
        });
      }
    }
  }
}
