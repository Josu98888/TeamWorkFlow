import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TenantPlanHandlers } from './tenant-plan.handlers';
import { TenantPurgeHandlers } from './tenant-purge.handlers';
import { TenantStatusBillingHandlers } from './tenant-status.billing.handlers';

@Module({
  imports: [EventsModule],
  providers: [
    TenantStatusBillingHandlers,
    TenantPlanHandlers,
    TenantPurgeHandlers,
  ],
})
export class TenantsModule {}
