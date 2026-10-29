import { Module } from '@nestjs/common';
import { SiteCacheService } from './site-cache.service';
import { EmployeeCacheService } from './employee-cache.service';
import { GeofenceService } from './geofence.service';

@Module({
  providers: [SiteCacheService, EmployeeCacheService, GeofenceService],
  exports: [SiteCacheService, EmployeeCacheService, GeofenceService],
})
export class GeofenceModule {}
