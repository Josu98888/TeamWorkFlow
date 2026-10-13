import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TenantStatusBillingHandlers } from './tenant-status.billing.handlers';

@Module({
  imports: [EventsModule],
  providers: [TenantStatusBillingHandlers],
})
export class TenantsModule {}
