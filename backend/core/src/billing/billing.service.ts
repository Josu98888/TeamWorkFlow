import { Injectable } from '@nestjs/common';
import {
  ForbiddenException,
} from '../common/exceptions/app.exceptions';
import type { InvoiceDto } from './invoicing/invoicing.service';
import { InvoicingService } from './invoicing/invoicing.service';
import type { PaymentDto } from './payments/payments.service';
import { PaymentsService } from './payments/payments.service';
import type { PlanDto, ServiceActor } from './plans/plans.service';
import { PlansService } from './plans/plans.service';
import type { SubscriptionDto } from './subscriptions/subscriptions.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import type { InvoiceStatus } from './prisma/generated/client';

@Injectable()
export class BillingService {
  constructor(
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly invoicing: InvoicingService,
    private readonly payments: PaymentsService,
  ) {}

  // 1. billing.plan.list
  async planList(actor: ServiceActor): Promise<PlanDto[]> {
    this.assertTenantRole(actor);
    return this.plans.listPlans();
  }

  // 2. billing.subscription.get
  async subscriptionGet(actor: ServiceActor): Promise<SubscriptionDto> {
    this.assertTenantRole(actor);
    return this.subscriptions.getSubscription(actor);
  }

  // 3. billing.subscription.change-plan
  async subscriptionChangePlan(
    actor: ServiceActor,
    plan: string,
  ): Promise<SubscriptionDto> {
    this.assertTenantRole(actor);
    return this.subscriptions.changePlan(actor, plan);
  }

  // 4. billing.subscription.cancel
  async subscriptionCancel(actor: ServiceActor): Promise<SubscriptionDto> {
    this.assertTenantRole(actor);
    return this.subscriptions.cancelSubscription(actor);
  }

  // 5. billing.subscription.cancel-undo
  async subscriptionCancelUndo(actor: ServiceActor): Promise<SubscriptionDto> {
    this.assertTenantRole(actor);
    return this.subscriptions.cancelUndo(actor);
  }

  // 6. billing.subscription.resubscribe
  async subscriptionResubscribe(
    actor: ServiceActor,
    plan: string,
  ): Promise<SubscriptionDto> {
    this.assertTenantRole(actor);
    return this.subscriptions.resubscribe(actor, plan);
  }

  // 7. billing.invoice.list
  async invoiceList(
    actor: ServiceActor,
    filters?: { status?: InvoiceStatus; period?: string },
    page = 1,
    pageSize = 20,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    this.assertTenantRole(actor);
    return this.invoicing.listInvoices(actor, filters, page, pageSize);
  }

  // 8. billing.invoice.get
  async invoiceGet(
    actor: ServiceActor,
    invoiceId: string,
  ): Promise<InvoiceDto> {
    this.assertTenantRole(actor);
    return this.invoicing.getInvoice(actor, invoiceId);
  }

  // 9. billing.invoice.payment-link
  async invoicePaymentLink(
    actor: ServiceActor,
    invoiceId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    this.assertTenantRole(actor);
    return this.payments.getPaymentLink(actor, invoiceId);
  }

  // 10. billing.webhook.mercadopago
  async webhookMercadopago(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): Promise<{ ok: boolean }> {
    return this.payments.handleWebhook(headers, rawBody);
  }

  // 11. billing.admin.plan.update
  async adminPlanUpdate(
    actor: ServiceActor,
    plan: string,
    monthlyPrice?: string | number,
    features?: Record<string, boolean>,
  ): Promise<PlanDto> {
    this.assertPlatformAdmin(actor);
    return this.plans.updatePlan(actor, plan, { monthlyPrice, features });
  }

  // 12. billing.admin.subscription.list
  async adminSubscriptionList(
    actor: ServiceActor,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: SubscriptionDto[]; total: number }> {
    this.assertPlatformAdmin(actor);
    return this.subscriptions.adminListSubscriptions(actor, page, pageSize);
  }

  // 13. billing.admin.subscription.extend-trial
  async adminSubscriptionExtendTrial(
    actor: ServiceActor,
    tenantId: string,
    trialEndsAt: Date | string,
  ): Promise<SubscriptionDto> {
    this.assertPlatformAdmin(actor);
    return this.subscriptions.adminExtendTrial(actor, tenantId, trialEndsAt);
  }

  // 14. billing.admin.invoice.list
  async adminInvoiceList(
    actor: ServiceActor,
    tenantId?: string,
    filters?: { status?: InvoiceStatus; period?: string },
    page = 1,
    pageSize = 20,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    this.assertPlatformAdmin(actor);
    return this.invoicing.listInvoices(
      actor,
      { ...filters, tenantId },
      page,
      pageSize,
    );
  }

  // 15. billing.admin.invoice.void
  async adminInvoiceVoid(
    actor: ServiceActor,
    invoiceId: string,
    reason: string,
  ): Promise<InvoiceDto> {
    this.assertPlatformAdmin(actor);
    return this.invoicing.adminVoidInvoice(actor, invoiceId, reason);
  }

  // 16. billing.admin.invoice.issue
  async adminInvoiceIssue(
    actor: ServiceActor,
    tenantId: string,
    period: string,
  ): Promise<InvoiceDto> {
    this.assertPlatformAdmin(actor);
    return this.invoicing.adminIssueInvoice(actor, tenantId, period);
  }

  // 17. billing.admin.invoice.set-fiscal-receipt
  async adminInvoiceSetFiscalReceipt(
    actor: ServiceActor,
    invoiceId: string,
    receiptNumber: string,
  ): Promise<InvoiceDto> {
    this.assertPlatformAdmin(actor);
    return this.invoicing.adminSetFiscalReceipt(actor, invoiceId, receiptNumber);
  }

  // 18. billing.admin.payment.register
  async adminPaymentRegister(
    actor: ServiceActor,
    invoiceId: string,
    amount: string | number,
    paidAt: Date | string,
    reference: string,
  ): Promise<{ id: string; status: string }> {
    this.assertPlatformAdmin(actor);
    return this.payments.adminRegisterPayment(actor, {
      invoiceId,
      amount,
      paidAt,
      reference,
    });
  }

  private assertTenantRole(actor: ServiceActor) {
    if (actor.role === 'platform_admin') {
      throw new ForbiddenException();
    }
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new ForbiddenException();
    }
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }
  }

  private assertPlatformAdmin(actor: ServiceActor) {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }
  }
}
