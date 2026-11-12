import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { BillingService } from '../billing.service';
import type { InvoiceDto } from '../invoicing/invoicing.service';
import type { PlanDto } from '../plans/plans.service';
import type { SubscriptionDto } from '../subscriptions/subscriptions.service';
import {
  ChangePlanDto,
  InvoiceIdParamDto,
  InvoiceListQueryDto,
  ResubscribeDto,
} from './dto/billing.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  listPlans(@CurrentActor() actor: VerifiedActor): Promise<PlanDto[]> {
    return this.billing.planList(actor);
  }

  @Get('subscription')
  getSubscription(
    @CurrentActor() actor: VerifiedActor,
  ): Promise<SubscriptionDto> {
    return this.billing.subscriptionGet(actor);
  }

  @Post('subscription/change-plan')
  changePlan(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: ChangePlanDto,
  ): Promise<SubscriptionDto> {
    return this.billing.subscriptionChangePlan(actor, body.plan);
  }

  @Post('subscription/cancel')
  cancelSubscription(
    @CurrentActor() actor: VerifiedActor,
  ): Promise<SubscriptionDto> {
    return this.billing.subscriptionCancel(actor);
  }

  @Post('subscription/cancel-undo')
  cancelUndo(
    @CurrentActor() actor: VerifiedActor,
  ): Promise<SubscriptionDto> {
    return this.billing.subscriptionCancelUndo(actor);
  }

  @Post('subscription/resubscribe')
  resubscribe(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: ResubscribeDto,
  ): Promise<SubscriptionDto> {
    return this.billing.subscriptionResubscribe(actor, body.plan);
  }

  @Get('invoices')
  listInvoices(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: InvoiceListQueryDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    return this.billing.invoiceList(
      actor,
      { status: query.status, period: query.period },
      query.page,
      query.pageSize,
    );
  }

  @Get('invoices/:invoiceId')
  getInvoice(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: InvoiceIdParamDto,
  ): Promise<InvoiceDto> {
    return this.billing.invoiceGet(actor, params.invoiceId);
  }

  @Post('invoices/:invoiceId/payment-link')
  getPaymentLink(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: InvoiceIdParamDto,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.billing.invoicePaymentLink(actor, params.invoiceId);
  }
}
