import { Module } from '@nestjs/common';
import { envs } from '../../config';
import {
  NOTIFICATIONS_EVENTS_OPTIONS,
  NotificationsEventsService,
} from './notifications-events.service';

@Module({
  providers: [
    {
      provide: NOTIFICATIONS_EVENTS_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    NotificationsEventsService,
  ],
  exports: [NotificationsEventsService],
})
export class NotificationsEventsModule {}
