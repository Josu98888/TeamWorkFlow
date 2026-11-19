import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { buildNatsOptions } from '../../config/nats-options';
import {
  ORGANIZATION_EVENTS_OPTIONS,
  OrganizationEventsService,
} from './organization-events.service';

// Private to `organization`.
@Module({
  providers: [
    {
      provide: ORGANIZATION_EVENTS_OPTIONS,
      useFactory: () => buildNatsOptions(envs.natsServers, envs.natsCreds),
    },
    OrganizationEventsService,
  ],
  exports: [OrganizationEventsService],
})
export class OrganizationEventsModule {}
