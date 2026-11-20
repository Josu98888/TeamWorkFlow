import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { envs } from './config';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationModule } from './organization/organization.module';
import { TasksModule } from './tasks/tasks.module';
import type { AuthenticatedRequest } from './http/authenticated-request';
import { AuthGuard } from './http/guards/auth.guard';
import { FeatureGuard } from './http/guards/feature.guard';
import { AppThrottlerGuard } from './http/guards/throttler.guard';
import { HealthController } from './http/health/health.controller';

@Module({
  // ScheduleModule.forRoot() is registered once here for every module's jobs.
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: (context) => {
          const req = context
            .switchToHttp()
            .getRequest<Partial<AuthenticatedRequest>>();
          return req.actor?.userId
            ? envs.rateLimitAuthTtlMs
            : envs.rateLimitPublicTtlMs;
        },
        limit: (context) => {
          const req = context
            .switchToHttp()
            .getRequest<Partial<AuthenticatedRequest>>();
          return req.actor?.userId
            ? envs.rateLimitAuthLimit
            : envs.rateLimitPublicLimit;
        },
      },
    ]),
    AuthModule,
    OrganizationModule,
    BillingModule,
    TasksModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
