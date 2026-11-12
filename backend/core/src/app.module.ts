import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { OrganizationModule } from './organization/organization.module';
import { TasksModule } from './tasks/tasks.module';
import { AuthGuard } from './http/guards/auth.guard';
import { FeatureGuard } from './http/guards/feature.guard';

@Module({
  // ScheduleModule.forRoot() is registered once here for every module's jobs.
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    OrganizationModule,
    BillingModule,
    TasksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule {}
