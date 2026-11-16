import { Body, Controller, Delete, Post } from '@nestjs/common';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { NotificationsService } from '../notifications.service';
import {
  RegisterPushTokenBodyDto,
  UnregisterPushTokenBodyDto,
} from './dto/notifications.dto';
import { toNotificationActor } from './notifications-actor';

@Controller('push-tokens')
export class PushTokensController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  register(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: RegisterPushTokenBodyDto,
  ) {
    return this.notificationsService.pushTokenRegister(
      toNotificationActor(actor),
      body,
    );
  }

  @Delete()
  unregister(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: UnregisterPushTokenBodyDto,
  ) {
    return this.notificationsService.pushTokenUnregister(
      toNotificationActor(actor),
      body,
    );
  }
}
