import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './http/guards/auth.guard';
import { OrganizationModule } from './organization/organization.module';

@Module({
  // ScheduleModule.forRoot() is registered once here for every module's jobs.
  imports: [ScheduleModule.forRoot(), AuthModule, OrganizationModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
