import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttendancePrismaModule } from './prisma/attendance-prisma.module';
import { NatsModule } from './nats/nats.module';
import { GeofenceModule } from './geofence/geofence.module';
import { ShiftsModule } from './shifts/shifts.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuthGuard } from './http/guards/auth.guard';

@Module({
  imports: [
    AttendancePrismaModule,
    NatsModule,
    GeofenceModule,
    ShiftsModule,
    TenantsModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
