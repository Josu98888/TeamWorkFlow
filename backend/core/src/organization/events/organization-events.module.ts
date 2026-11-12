import { Module } from '@nestjs/common';
import { envs } from '../../config';
import {
  ORGANIZATION_EVENTS_OPTIONS,
  OrganizationEventsService,
} from './organization-events.service';

// Private to `organization`.
@Module({
  providers: [
    {
      provide: ORGANIZATION_EVENTS_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    OrganizationEventsService,
  ],
  exports: [OrganizationEventsService],
})
export class OrganizationEventsModule {}
