import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './http/guards/auth.guard';
import { OrganizationModule } from './organization/organization.module';

@Module({
  imports: [AuthModule, OrganizationModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
