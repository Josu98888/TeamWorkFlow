import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { BillingService } from '../billing.service';
import type { InvoiceDto } from '../invoicing/invoicing.service';
import type { PlanDto } from '../plans/plans.service';
import type { SubscriptionDto } from '../subscriptions/subscriptions.service';
import {
  AdminExtendTrialDto,
  AdminIssueInvoiceDto,
  AdminRegisterPaymentDto,
  AdminSetFiscalReceiptDto,
  AdminUpdatePlanDto,
  AdminVoidInvoiceDto,
  InvoiceIdParamDto,
  InvoiceListQueryDto,
  PaginationQueryDto,
  PlanParamDto,
  TenantIdParamDto,
} from './dto/billing.dto';

@Controller('billing/admin')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Put('plans/:plan')
  updatePlan(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: PlanParamDto,
    @Body() body: AdminUpdatePlanDto,
  ): Promise<PlanDto> {
    return this.billing.adminPlanUpdate(
      actor,
      params.plan,
      body.monthlyPrice,
      body.features,
    );
  }

  @Get('subscriptions')
  listSubscriptions(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: PaginationQueryDto,
  ): Promise<{ items: SubscriptionDto[]; total: number }> {
    return this.billing.adminSubscriptionList(actor, query.page, query.pageSize);
  }

  @Post('subscriptions/:tenantId/extend-trial')
  extendTrial(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: TenantIdParamDto,
    @Body() body: AdminExtendTrialDto,
  ): Promise<SubscriptionDto> {
    return this.billing.adminSubscriptionExtendTrial(
      actor,
      params.tenantId,
      body.trialEndsAt,
    );
  }

  @Get('invoices')
  listInvoices(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: InvoiceListQueryDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    return this.billing.adminInvoiceList(
      actor,
      undefined,
      { status: query.status, period: query.period },
      query.page,
      query.pageSize,
    );
  }

  @Post('invoices/:invoiceId/void')
  voidInvoice(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: InvoiceIdParamDto,
    @Body() body: AdminVoidInvoiceDto,
  ): Promise<InvoiceDto> {
    return this.billing.adminInvoiceVoid(actor, params.invoiceId, body.reason);
  }

  @Post('invoices')
  issueInvoice(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: AdminIssueInvoiceDto,
  ): Promise<InvoiceDto> {
    return this.billing.adminInvoiceIssue(actor, body.tenantId, body.period);
  }

  @Put('invoices/:invoiceId/fiscal-receipt')
  setFiscalReceipt(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: InvoiceIdParamDto,
    @Body() body: AdminSetFiscalReceiptDto,
  ): Promise<InvoiceDto> {
    return this.billing.adminInvoiceSetFiscalReceipt(
      actor,
      params.invoiceId,
      body.receiptNumber,
    );
  }

  @Post('payments')
  registerPayment(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: AdminRegisterPaymentDto,
  ): Promise<{ id: string; status: string }> {
    return this.billing.adminPaymentRegister(
      actor,
      body.invoiceId,
      body.amount,
      body.paidAt,
      body.reference,
    );
  }
}
