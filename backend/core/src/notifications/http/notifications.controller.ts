import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { NotificationsService } from '../notifications.service';
import {
  ListNotificationsQueryDto,
  MarkReadBodyDto,
  MarkReadParamDto,
} from './dto/notifications.dto';
import { toNotificationActor } from './notifications-actor';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.notificationList(
      toNotificationActor(actor),
      query,
    );
  }

  @Get('unread-count')
  unreadCount(@CurrentActor() actor: VerifiedActor) {
    return this.notificationsService.notificationUnreadCount(
      toNotificationActor(actor),
    );
  }

  @Post(':id/read')
  markRead(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: MarkReadParamDto,
    @Body() body?: MarkReadBodyDto,
  ) {
    const all = param.id === 'all' || body?.all === true;
    return this.notificationsService.notificationMarkRead(
      toNotificationActor(actor),
      all ? { all: true } : { notificationId: param.id },
    );
  }
}
