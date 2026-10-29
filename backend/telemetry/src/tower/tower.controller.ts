import { Controller, Get } from '@nestjs/common';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { RequireFeature } from '../http/decorators/features.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { TowerService } from './tower.service';

@Controller('tower')
@RequireFeature('tower')
export class TowerController {
  constructor(private readonly towerService: TowerService) {}

  @Get('snapshot')
  @Roles('supervisor', 'admin', 'owner')
  getSnapshot(@CurrentActor() actor: VerifiedActor) {
    return this.towerService.getSnapshot(actor);
  }
}
