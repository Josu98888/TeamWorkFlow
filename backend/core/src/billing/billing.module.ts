import { Module } from '@nestjs/common';
import { envs } from '../config';
import { BillingService } from './billing.service';
import { CollectionsJob } from './collections/collections.job';
import { CollectionsService } from './collections/collections.service';
import { CLOCK_SERVICE, SystemClockService } from './common/clock.service';
import { BillingEventsModule } from './events/billing-events.module';
import { ConsumedEventProcessor } from './events/consumed-event.processor';
import { DataRetentionHandler } from './events/data-retention.handler';
import { TenantCreatedHandler } from './events/tenant-created.handler';
import { BillingAdminController } from './http/billing-admin.controller';
import { BillingWebhookController } from './http/billing-webhook.controller';
import { BillingController } from './http/billing.controller';
import { InvoicingService } from './invoicing/invoicing.service';
import { MonthlyCloseJob } from './invoicing/monthly-close.job';
import { FakePaymentProviderService } from './payments/fake-payment-provider.service';
import { MercadoPagoProviderService } from './payments/mercadopago-provider.service';
import { PAYMENT_PROVIDER } from './payments/payment-provider.interface';
import { PaymentsService } from './payments/payments.service';
import { ReconciliationJob } from './payments/reconciliation.job';
import { PlansService } from './plans/plans.service';
import { BillingPrismaService } from './prisma/prisma.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { TrialExpirationJob } from './subscriptions/trial-expiration.job';

@Module({
  imports: [BillingEventsModule],
  controllers: [
    BillingController,
    BillingAdminController,
    BillingWebhookController,
  ],
  providers: [
    BillingPrismaService,
    {
      provide: CLOCK_SERVICE,
      useClass: SystemClockService,
    },
    FakePaymentProviderService,
    MercadoPagoProviderService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (
        fake: FakePaymentProviderService,
        mp: MercadoPagoProviderService,
      ) => (envs.paymentProvider === 'mercadopago' ? mp : fake),
      inject: [FakePaymentProviderService, MercadoPagoProviderService],
    },
    PlansService,
    SubscriptionsService,
    TrialExpirationJob,
    InvoicingService,
    MonthlyCloseJob,
    PaymentsService,
    ReconciliationJob,
    CollectionsService,
    CollectionsJob,
    ConsumedEventProcessor,
    TenantCreatedHandler,
    DataRetentionHandler,
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
