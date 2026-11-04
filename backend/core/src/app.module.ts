import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { AuthGuard } from './http/guards/auth.guard';
import { FeatureGuard } from './http/guards/feature.guard';
import { OrganizationModule } from './organization/organization.module';

@Module({
  // ScheduleModule.forRoot() is registered once here for every module's jobs.
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    OrganizationModule,
    BillingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule {}
