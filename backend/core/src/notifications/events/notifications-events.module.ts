import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { buildNatsOptions } from '../../config/nats-options';
import {
  NOTIFICATIONS_EVENTS_OPTIONS,
  NotificationsEventsService,
} from './notifications-events.service';

@Module({
  providers: [
    {
      provide: NOTIFICATIONS_EVENTS_OPTIONS,
      useFactory: () => buildNatsOptions(envs.natsServers, envs.natsCreds),
    },
    NotificationsEventsService,
  ],
  exports: [NotificationsEventsService],
})
export class NotificationsEventsModule {}
