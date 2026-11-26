import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { envs } from './config';
import { AttendancePrismaModule } from './prisma/attendance-prisma.module';
import { NatsModule } from './nats/nats.module';
import { GeofenceModule } from './geofence/geofence.module';
import { ShiftsModule } from './shifts/shifts.module';
import { TenantsModule } from './tenants/tenants.module';
import { WorkdaysModule } from './workdays/workdays.module';
import { AlertsModule } from './alerts/alerts.module';
import { ClockInsModule } from './clock-ins/clock-ins.module';
import { CompensationModule } from './compensation/compensation.module';
import { TowerModule } from './tower/tower.module';
import { ConsumersModule } from './consumers/consumers.module';
import { ReportsModule } from './reports/reports.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { AuthGuard } from './http/guards/auth.guard';
import { AppThrottlerGuard } from './http/guards/throttler.guard';
import { HealthController } from './http/health/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: envs.rateLimitAuthTtlMs,
        limit: envs.rateLimitAuthLimit,
      },
    ]),
    AttendancePrismaModule,
    NatsModule,
    GeofenceModule,
    ShiftsModule,
    TenantsModule,
    WorkdaysModule,
    AlertsModule,
    TowerModule,
    ClockInsModule,
    SnapshotsModule,
    CompensationModule,
    ReportsModule,
    ConsumersModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
