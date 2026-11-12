import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WorkdaysModule } from '../workdays/workdays.module';
import { TowerModule } from '../tower/tower.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [ShiftsModule, TenantsModule, WorkdaysModule, TowerModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
