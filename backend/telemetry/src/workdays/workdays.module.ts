import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { GeofenceModule } from '../geofence/geofence.module';
import { WorkdaysController } from './workdays.controller';
import { WorkdaysMonitorJob } from './workdays-monitor.job';
import { WorkdaysService } from './workdays.service';

@Module({
  imports: [ShiftsModule, TenantsModule, GeofenceModule],
  controllers: [WorkdaysController],
  providers: [WorkdaysService, WorkdaysMonitorJob],
  exports: [WorkdaysService, WorkdaysMonitorJob],
})
export class WorkdaysModule {}
