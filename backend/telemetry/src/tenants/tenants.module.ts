import { Module } from '@nestjs/common';
import { TenantStateService } from './tenant-state.service';

@Module({
  providers: [TenantStateService],
  exports: [TenantStateService],
})
export class TenantsModule {}
