import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { RequireFeature } from '../http/decorators/features.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { AlertsService } from './alerts.service';
import {
  AlertIdParamDto,
  ListAlertsDto,
  ResolveAlertDto,
} from './dto';

@Controller('alerts')
@RequireFeature('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles('supervisor', 'admin', 'owner')
  listAlerts(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListAlertsDto,
  ) {
    return this.alertsService.listAlerts(actor, query);
  }

  @Post(':alertId/acknowledge')
  @Roles('supervisor', 'admin', 'owner')
  acknowledgeAlert(
    @CurrentActor() actor: VerifiedActor,
    @Param() { alertId }: AlertIdParamDto,
  ) {
    return this.alertsService.acknowledgeAlert(actor, alertId);
  }

  @Post(':alertId/resolve')
  @Roles('supervisor', 'admin', 'owner')
  resolveAlert(
    @CurrentActor() actor: VerifiedActor,
    @Param() { alertId }: AlertIdParamDto,
    @Body() dto: ResolveAlertDto,
  ) {
    return this.alertsService.resolveAlert(actor, alertId, dto);
  }
}
