import { Module } from '@nestjs/common';
import { GeofenceModule } from '../geofence/geofence.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WorkdaysModule } from '../workdays/workdays.module';
import { ClockInsController } from './clock-ins.controller';
import { ClockInsService } from './clock-ins.service';

@Module({
  imports: [GeofenceModule, ShiftsModule, TenantsModule, WorkdaysModule],
  controllers: [ClockInsController],
  providers: [ClockInsService],
  exports: [ClockInsService],
})
export class ClockInsModule {}
