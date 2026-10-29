import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TowerController } from './tower.controller';
import { TowerGateway } from './tower.gateway';
import { TowerService } from './tower.service';

@Module({
  imports: [TenantsModule],
  controllers: [TowerController],
  providers: [TowerGateway, TowerService],
  exports: [TowerService, TowerGateway],
})
export class TowerModule {}
