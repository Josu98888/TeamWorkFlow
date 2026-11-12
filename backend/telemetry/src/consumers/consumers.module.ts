import { Module } from '@nestjs/common';
import { ConsumedEventProcessor } from './consumed-event.processor';
import { OrganizationConsumer } from './handlers/organization.handler';
import { AuthConsumer } from './handlers/auth.handler';
import { BillingConsumer } from './handlers/billing.handler';
import { ShiftsModule } from '../shifts/shifts.module';
import { WorkdaysModule } from '../workdays/workdays.module';
import { GeofenceModule } from '../geofence/geofence.module';
import { TowerModule } from '../tower/tower.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [
    TenantsModule,
    GeofenceModule,
    ShiftsModule,
    WorkdaysModule,
    TowerModule,
  ],
  providers: [
    ConsumedEventProcessor,
    OrganizationConsumer,
    AuthConsumer,
    BillingConsumer,
  ],
  exports: [
    ConsumedEventProcessor,
    OrganizationConsumer,
    AuthConsumer,
    BillingConsumer,
  ],
})
export class ConsumersModule {}
