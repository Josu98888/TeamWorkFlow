import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { buildNatsOptions } from '../../config/nats-options';
import {
  BILLING_EVENTS_OPTIONS,
  BillingEventsService,
} from './billing-events.service';

@Module({
  providers: [
    {
      provide: BILLING_EVENTS_OPTIONS,
      useFactory: () => buildNatsOptions(envs.natsServers, envs.natsCreds),
    },
    BillingEventsService,
  ],
  exports: [BillingEventsService],
})
export class BillingEventsModule {}
